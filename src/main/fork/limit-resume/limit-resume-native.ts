// Limit resume (FORK.md, SLRM-2309) for native chats. Stock Orca already parks a native Claude or
// Codex chat cut by a usage limit and continues it at the reset (`StructuredAgentSessionUsageLimit
// Continue`), behind a toggle that is off by default. The fork turns it on with
// `forkLimitResume`, caps its chain at `forkLimitResumeMaxTries`, and holds it while the chat's
// message box has text. The three hooks below are what the stock files call. Keep electron out.
import { isForkAgentGuardHeld } from '../agent-guards/agent-guards-holds'
import {
  limitResumeNativeContinueOn,
  readLimitResumeSettings,
  type LimitResumeEntry,
  type LimitResumeSettingsSource
} from '../../../shared/fork/limit-resume'
import type { AgentSessionStatusSummary } from '../../../shared/agent-session/agent-session-wire'
import { NATIVE_CHAT_USAGE_LIMIT_CONTINUE_MESSAGE } from '../../../shared/native-chat/transcript/continuation/native-chat-usage-limit-cut'
import { USAGE_LIMIT_CONTINUE_CHAIN_LIMIT } from '../../native-chat/agent-session-wire/recovery/structured-agent-session-usage-limit-chain'
import { forkBoundaryCompactionTyped } from '../boundary-compaction/boundary-compaction-typed'
import type { IdleRecoveryChatPort } from '../idle-recovery/idle-recovery-ports'
import type { ForkLimitsActionOutcome } from '../../../shared/fork/limit-resume-wire'

let readSettings: () => LimitResumeSettingsSource = () => null

/** The service hands the hooks this process's settings at start-up. */
export function setForkLimitResumeSettingsReader(read: () => LimitResumeSettingsSource): void {
  readSettings = read
}

/** Hook: `runtime-structured-agent-host.ts` reads this instead of the stock toggle alone. */
export const forkUsageLimitAutoContinueOn = limitResumeNativeContinueOn

/** Hook: the most automatic continues in a row; never more than stock counts. */
export function forkUsageLimitChainLimit(): number {
  return Math.min(
    readLimitResumeSettings(readSettings()).maxTries,
    USAGE_LIMIT_CONTINUE_CHAIN_LIMIT
  )
}

/** Hook: a chat whose message box holds text waits, but only `forkLimitResumeHoldMaxMinutes` past
 *  the reset (`overdueMs`), so a forgotten draft cannot park the chat for good (BAD-707). It is
 *  asked again each pass. A chat an agent guard paused (SLRM-2385) waits too, until a person
 *  resumes it. */
export function forkUsageLimitHeld(sessionId: string, overdueMs = 0): boolean {
  if (isForkAgentGuardHeld(sessionId)) {
    return true
  }
  const settings = readLimitResumeSettings(readSettings())
  return (
    settings.enabled &&
    settings.holdWhileTyping &&
    overdueMs < settings.holdMaxMinutes * 60_000 &&
    forkBoundaryCompactionTyped(sessionId) === true
  )
}

export type LimitResumeNativeHost = {
  deps: { store: { listVisibleSessionIds: () => readonly string[] } }
  readStatusSummary: (sessionId: string) => AgentSessionStatusSummary | undefined
  usageLimitContinue: {
    cancel: (input: { sessionId: string; turnItemId: string; resetsAt: number }) => Promise<void>
  }
}

export type LimitResumeChatRow = { paneKey: string; worktreeId: string | null; title: string }

const STATE: Record<string, LimitResumeEntry['state'] | undefined> = {
  scheduled: 'parked',
  cancelled: 'cancelled',
  failed: 'exhausted'
}

/** The native chats the stock continue has parked, as `orca limits list` shows them. */
export function limitResumeNativeEntries(
  host: LimitResumeNativeHost | null,
  rows: ReadonlyMap<string, LimitResumeChatRow>
): LimitResumeEntry[] {
  if (!host) {
    return []
  }
  const entries: LimitResumeEntry[] = []
  for (const sessionId of host.deps.store.listVisibleSessionIds()) {
    const summary = host.readStatusSummary(sessionId)
    const scheduled = summary?.usageLimitContinue
    const state = scheduled ? STATE[scheduled.state] : undefined
    if (!summary || !scheduled || !state) {
      continue
    }
    const row = rows.get(sessionId)
    entries.push({
      id: `chat:${sessionId}`,
      kind: 'chat',
      paneKey: row?.paneKey ?? `chat:${sessionId}`,
      sessionId,
      worktreeId: row?.worktreeId ?? null,
      agent: summary.agent,
      title: row?.title ?? '',
      resetsAt: scheduled.resetsAt,
      resumeAt: scheduled.continueAt ?? scheduled.resetsAt,
      tries: 0,
      maxTries: forkUsageLimitChainLimit(),
      state,
      line: ''
    })
  }
  return entries
}

/** `orca limits cancel` for a native chat: the stock "Don't continue". */
export async function cancelLimitResumeNative(
  host: LimitResumeNativeHost | null,
  sessionId: string
): Promise<boolean> {
  const scheduled = host?.readStatusSummary(sessionId)?.usageLimitContinue
  if (!host || !scheduled) {
    return false
  }
  await host.usageLimitContinue.cancel({
    sessionId,
    turnItemId: scheduled.turnItemId,
    resetsAt: scheduled.resetsAt
  })
  return true
}

/** `orca limits resume-now` for a native chat: the stock continue message, sent now as a queued
 *  message so a chat that got busy holds it instead of being steered. */
export async function resumeLimitResumeNativeNow(
  port: IdleRecoveryChatPort,
  sessionId: string
): Promise<ForkLimitsActionOutcome> {
  const facts = port.read(sessionId)
  if (!facts || facts.inTurn) {
    return 'refused'
  }
  if (forkUsageLimitHeld(sessionId)) {
    return 'refused'
  }
  const outcome = await port.send(sessionId, NATIVE_CHAT_USAGE_LIMIT_CONTINUE_MESSAGE, facts.fence)
  return outcome === 'queued' ? 'sent' : outcome
}
