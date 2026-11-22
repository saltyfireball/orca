// Auto-continue filter (FORK.md, BAD-560): which of the chats a restart cut upstream's launch
// continuation may continue by itself. Workers with an open dispatch and the chats of automation
// runs always; a person's own chats only with `forkAutoContinueInteractive`. A chat left out keeps
// the restart offer for the person.
import {
  autoContinueInteractiveOn,
  chatRunsAutomation,
  type AutoContinueAutomationRunFacts
} from '../../../shared/fork/auto-continue'
import type { StructuredAgentSessionResumeCandidate } from '../../native-chat/agent-session-wire/recovery/structured-agent-session-restart-resume-set'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { structuredWorkerOwesWork } from '../../runtime/orchestration/terminal-authority/structured-sessions/structured-worker-custody'
import type { AgentSessionRecord } from '../../../shared/agent-session/lifecycle/agent-session-record'

export type AutoContinueSources = {
  settings: () => unknown
  list: () => Promise<readonly StructuredAgentSessionResumeCandidate[]>
  record: (sessionId: string) => AgentSessionRecord | null
  orchestrationDb: () => OrchestrationDb | null
  automationRuns: () => readonly AutoContinueAutomationRunFacts[]
}

/** The chats to continue, or undefined for all of them (the interactive setting is on). */
export async function forkAutoContinueChats(
  sources: AutoContinueSources
): Promise<string[] | undefined> {
  const settings = sources.settings()
  if (autoContinueInteractiveOn(typeof settings === 'object' ? (settings as object) : null)) {
    return undefined
  }
  let runs: readonly AutoContinueAutomationRunFacts[] | null = null
  const unattended = (candidate: StructuredAgentSessionResumeCandidate): boolean => {
    const record = sources.record(candidate.sessionId)
    if (record) {
      try {
        if (structuredWorkerOwesWork(sources.orchestrationDb(), record)) {
          return true
        }
      } catch (error) {
        console.warn('[fork-auto-continue] reading worker dispatches failed:', error)
      }
    }
    try {
      runs ??= sources.automationRuns()
    } catch (error) {
      console.warn('[fork-auto-continue] reading automation runs failed:', error)
      runs = []
    }
    return chatRunsAutomation(candidate.sessionId, candidate.recordedAt, runs)
  }
  return (await sources.list()).filter(unattended).map((candidate) => candidate.sessionId)
}

/** The runtime parts the live filter reads. Structural, so the upstream runtime class fits as is. */
export type AutoContinueRuntime = {
  requireStore: () => {
    getSettings: () => unknown
    listAutomationRuns?: () => readonly AutoContinueAutomationRunFacts[]
  }
  getExistingOrchestrationDb: () => OrchestrationDb | null
}

export async function forkAutoContinueForRuntime(
  runtime: AutoContinueRuntime
): Promise<string[] | undefined> {
  const { getStructuredAgentSessionHost } =
    await import('../../native-chat/agent-session-wire/host/structured-agent-session-registry')
  const host = getStructuredAgentSessionHost()
  if (!host) {
    return undefined
  }
  return forkAutoContinueChats({
    settings: () => runtime.requireStore().getSettings(),
    list: () => host.restartResume.list(),
    record: (sessionId) => host.deps.store.getRecord(sessionId),
    orchestrationDb: () => runtime.getExistingOrchestrationDb(),
    automationRuns: () => runtime.requireStore().listAutomationRuns?.() ?? []
  })
}
