// Unattended resume (FORK.md, SLRM-2268): once per process, after start-up settles, continue the
// turns a restart or update cut in chats nobody is watching. Runs wherever the chat host runs: the
// desktop app and the headless server (`orca serve`, orcad) both reach it through the runtime's
// start-up hook. Interactive chats keep the stock offer; the rule is in
// `src/shared/fork/unattended-resume.ts`. The continuation is the stock one ("Continue" in the
// restart offer), sent through the host's own `continueAfterRestart`, so it re-checks
// eligibility, reserves the offer and writes the same chat notes.
import {
  chatRunsAutomation,
  decideUnattendedResume,
  pickUnattendedResumeSettings,
  readUnattendedResumeSettings,
  type UnattendedAutomationRunFacts,
  type UnattendedResumeDecision,
  type UnattendedResumeSettingsSource,
  type UnattendedRunKind
} from '../../../shared/fork/unattended-resume'
import type { AgentSessionResumeMarker } from '../../../shared/agent-session/lifecycle/resume/agent-session-resume-marker'
import type { AgentSessionRecord } from '../../../shared/agent-session/lifecycle/agent-session-record'
import type { StructuredAgentSessionResumeCandidate } from '../../native-chat/agent-session-wire/recovery/structured-agent-session-restart-resume-set'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { StructuredAgentSessionRestartResume } from '../../native-chat/agent-session-wire/recovery/structured-agent-session-restart-resume-contract'
import {
  readUnattendedResumeTries,
  unattendedResumeTriesPath,
  writeUnattendedResumeTries,
  type UnattendedResumeTries
} from './unattended-resume-tries'

export const UNATTENDED_RESUME_OWNER = 'trusted-local:fork-unattended-resume'

export type UnattendedResumeHost = {
  list: () => Promise<StructuredAgentSessionResumeCandidate[]>
  continueAfterRestart: (
    sessionIds: readonly string[],
    owner: string
  ) => ReturnType<StructuredAgentSessionRestartResume['continueAfterRestart']>
}

export type UnattendedResumeDeps = {
  settings: () => UnattendedResumeSettingsSource
  /** Interrupted turns saved at the last stop; read from disk, so no chat host is needed. */
  listMarkers: () => Promise<readonly Pick<AgentSessionResumeMarker, 'sessionId'>[]>
  /** Installs the chat host (only when there is something to continue). */
  host: () => Promise<UnattendedResumeHost | null>
  /** Why nobody is watching the chat, or null for an interactive one. */
  classify: (candidate: StructuredAgentSessionResumeCandidate) => UnattendedRunKind | null
  readTries: () => Promise<UnattendedResumeTries>
  writeTries: (tries: UnattendedResumeTries) => void
  now: () => number
  log: (message: string, fields?: Record<string, unknown>) => void
}

export type UnattendedResumePassResult = {
  decisions: { sessionId: string; decision: UnattendedResumeDecision }[]
  continued: { sessionId: string; outcome: string }[]
}

/** One pass: decide for every offer, count the tries first, then continue the chosen chats. */
export async function runUnattendedResumePass(
  deps: UnattendedResumeDeps
): Promise<UnattendedResumePassResult> {
  const result: UnattendedResumePassResult = { decisions: [], continued: [] }
  const settings = readUnattendedResumeSettings(deps.settings())
  if (!settings.enabled) {
    return result
  }
  const markers = await deps.listMarkers()
  const tries = await deps.readTries()
  // A chat with no cut turn this start got through a whole run: its streak ends.
  const interrupted = new Set(markers.map((marker) => marker.sessionId))
  let changed = false
  for (const sessionId of tries.keys()) {
    if (!interrupted.has(sessionId)) {
      tries.delete(sessionId)
      changed = true
    }
  }
  if (markers.length === 0) {
    if (changed) {
      deps.writeTries(tries)
    }
    return result
  }
  const host = await deps.host()
  if (!host) {
    if (changed) {
      deps.writeTries(tries)
    }
    return result
  }
  const candidates = await host.list()
  const chosen: string[] = []
  for (const candidate of candidates) {
    const decision = decideUnattendedResume({
      settings,
      kind: deps.classify(candidate),
      activity: candidate.activity,
      triesUsed: tries.get(candidate.sessionId)?.tries ?? 0
    })
    result.decisions.push({ sessionId: candidate.sessionId, decision })
    if (decision.action === 'resume') {
      chosen.push(candidate.sessionId)
    } else if (decision.reason === 'tries-used' || decision.reason === 'awaiting-person') {
      deps.log('left an interrupted unattended chat for a person', {
        sessionId: candidate.sessionId,
        reason: decision.reason
      })
    }
  }
  if (chosen.length === 0) {
    if (changed) {
      deps.writeTries(tries)
    }
    return result
  }
  // Count before sending: a crash during the send must still use up a try.
  const at = deps.now()
  for (const sessionId of chosen) {
    tries.set(sessionId, { tries: (tries.get(sessionId)?.tries ?? 0) + 1, lastTryAt: at })
  }
  deps.writeTries(tries)
  const action = await host.continueAfterRestart(chosen, UNATTENDED_RESUME_OWNER)
  for (const outcome of action.continued) {
    result.continued.push({ sessionId: outcome.sessionId, outcome: outcome.outcome })
    deps.log('continued an interrupted unattended chat', {
      sessionId: outcome.sessionId,
      outcome: outcome.outcome,
      ...(outcome.reason ? { reason: outcome.reason } : {})
    })
  }
  return result
}

/** The runtime parts the live pass reads. Structural, so the upstream runtime class fits as is. */
export type UnattendedResumeRuntime = {
  requireStore: () => {
    getSettings: () => unknown
    listAutomationRuns?: () => readonly UnattendedAutomationRunFacts[]
  }
  ensureStructuredAgentSessionHost: () => Promise<void>
  getExistingOrchestrationDb: () => OrchestrationDb | null
}

let started = false

/**
 * The start-up hook. Once per process: the runtime calls its start-up hook again after a chat
 * runtime teardown, and a second pass then would count tries for turns this process cut itself.
 */
export function startForkUnattendedResume(runtime: UnattendedResumeRuntime): void {
  // Runtime tests reach this hook too; the pass reads the real profile folder, so it stays off there.
  if (started || process.env.VITEST) {
    return
  }
  started = true
  void runLiveUnattendedResume(runtime).catch((error: unknown) => {
    console.warn('[fork-unattended-resume] the start-up pass failed:', error)
  })
}

async function runLiveUnattendedResume(runtime: UnattendedResumeRuntime): Promise<void> {
  const [{ getProfileUserDataPath }, { AgentSessionRecoveryCapsule }] = await Promise.all([
    import('../../orca-profiles/profile-storage-paths'),
    import('../../runtime/agent-session/records/agent-session-recovery-capsule')
  ])
  const stateDirectory = getProfileUserDataPath()
  const triesPath = unattendedResumeTriesPath(stateDirectory)
  const capsule = new AgentSessionRecoveryCapsule(stateDirectory)
  let records: ((sessionId: string) => AgentSessionRecord | null) | null = null
  await runUnattendedResumePass({
    settings: () => pickUnattendedResumeSettings(runtime.requireStore().getSettings()),
    listMarkers: () => capsule.list(Date.now()),
    host: async () => {
      await runtime.ensureStructuredAgentSessionHost()
      const { getStructuredAgentSessionHost } =
        await import('../../native-chat/agent-session-wire/host/structured-agent-session-registry')
      const host = getStructuredAgentSessionHost()
      if (!host) {
        return null
      }
      records = (sessionId) => host.deps.store.getRecord(sessionId)
      return {
        list: () => host.restartResume.list(),
        continueAfterRestart: (sessionIds, owner) =>
          host.restartResume.continueAfterRestart(sessionIds, owner)
      }
    },
    classify: await liveClassifier(runtime, () => records),
    readTries: () => readUnattendedResumeTries(triesPath),
    writeTries: (tries) => writeUnattendedResumeTries(triesPath, tries),
    now: () => Date.now(),
    log: (message, fields) => console.log(`[fork-unattended-resume] ${message}`, fields ?? {})
  })
}

async function liveClassifier(
  runtime: UnattendedResumeRuntime,
  records: () => ((sessionId: string) => AgentSessionRecord | null) | null
): Promise<UnattendedResumeDeps['classify']> {
  const { structuredWorkerOwesWork } =
    await import('../../runtime/orchestration/terminal-authority/structured-sessions/structured-worker-custody')
  let runs: readonly UnattendedAutomationRunFacts[] | null = null
  return (candidate) => {
    const record = records()?.(candidate.sessionId) ?? null
    if (record) {
      try {
        if (structuredWorkerOwesWork(runtime.getExistingOrchestrationDb(), record)) {
          return 'worker'
        }
      } catch (error) {
        console.warn('[fork-unattended-resume] reading worker dispatches failed:', error)
      }
    }
    try {
      runs ??= runtime.requireStore().listAutomationRuns?.() ?? []
    } catch (error) {
      console.warn('[fork-unattended-resume] reading automation runs failed:', error)
      runs = []
    }
    return chatRunsAutomation(candidate.sessionId, candidate.recordedAt, runs) ? 'automation' : null
  }
}

/** Tests only. */
export function resetForkUnattendedResumeForTests(): void {
  started = false
}
