// Unattended resume (FORK.md, SLRM-2268): its settings and its rule. A server restart or update
// cuts every running turn. Stock Orca offers to continue them and waits for a person to say yes.
// Work nobody is watching (an orchestration worker with an open dispatch, the chat of an
// automation run) carries on by itself instead, a limited number of times in a row, and never
// when the cut turn was waiting on a person (an approval or a question). Interactive chats keep
// the stock offer. Idea from T3 Code's "Recovering interrupted threads" (MIT).
import type { AgentSessionRestartActivity } from '../agent-session/lifecycle/agent-session-restart-activity'
import type { ForkGlobalSettings } from './fork-global-settings'

export const UNATTENDED_RESUME_DEFAULT_MAX_TRIES = 3
export const UNATTENDED_RESUME_MIN_MAX_TRIES = 1
export const UNATTENDED_RESUME_MAX_MAX_TRIES = 20

export type UnattendedResumeSettings = {
  enabled: boolean
  maxTries: number
}

type SettingKey = keyof Pick<
  ForkGlobalSettings,
  'forkUnattendedResume' | 'forkUnattendedResumeMaxTries'
>

/** Any settings object; values are checked here, so a hand-edited file cannot break a reader. */
export type UnattendedResumeSettingsSource = Partial<Record<SettingKey, unknown>> | null | undefined

/** The two settings out of a whole settings object read off the store, which is typed narrower. */
export function pickUnattendedResumeSettings(value: unknown): UnattendedResumeSettingsSource {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  return {
    forkUnattendedResume: 'forkUnattendedResume' in value ? value.forkUnattendedResume : undefined,
    forkUnattendedResumeMaxTries:
      'forkUnattendedResumeMaxTries' in value ? value.forkUnattendedResumeMaxTries : undefined
  }
}

export function readUnattendedResumeSettings(
  settings: UnattendedResumeSettingsSource
): UnattendedResumeSettings {
  const tries = settings?.forkUnattendedResumeMaxTries
  return {
    enabled: settings?.forkUnattendedResume !== false,
    maxTries:
      typeof tries === 'number' &&
      Number.isInteger(tries) &&
      tries >= UNATTENDED_RESUME_MIN_MAX_TRIES &&
      tries <= UNATTENDED_RESUME_MAX_MAX_TRIES
        ? tries
        : UNATTENDED_RESUME_DEFAULT_MAX_TRIES
  }
}

/** Why nobody is watching the chat; null is an interactive chat. */
export type UnattendedRunKind = 'worker' | 'automation'

export type UnattendedResumeSkipReason =
  | 'disabled'
  | 'interactive'
  | 'awaiting-person'
  | 'activity-unknown'
  | 'tries-used'

export type UnattendedResumeDecision =
  | { action: 'resume' }
  | { action: 'skip'; reason: UnattendedResumeSkipReason }

export type UnattendedResumeFacts = {
  settings: UnattendedResumeSettings
  kind: UnattendedRunKind | null
  /** What the turn was doing when the stop cut it; absent on markers from older builds. */
  activity: AgentSessionRestartActivity | undefined
  /** Automatic continuations already sent for this chat in a row. */
  triesUsed: number
}

/** A cut turn that was asking a person something must wait for that person. */
export function restartActivityAwaitsPerson(activity: AgentSessionRestartActivity): boolean {
  return activity.state === 'blocked' || activity.prompts.length > 0
}

export function decideUnattendedResume(facts: UnattendedResumeFacts): UnattendedResumeDecision {
  if (!facts.settings.enabled) {
    return { action: 'skip', reason: 'disabled' }
  }
  if (facts.kind === null) {
    return { action: 'skip', reason: 'interactive' }
  }
  // Without the stop-time capture nothing proves the turn was not waiting on an approval.
  if (!facts.activity) {
    return { action: 'skip', reason: 'activity-unknown' }
  }
  if (restartActivityAwaitsPerson(facts.activity)) {
    return { action: 'skip', reason: 'awaiting-person' }
  }
  if (facts.triesUsed >= facts.settings.maxTries) {
    return { action: 'skip', reason: 'tries-used' }
  }
  return { action: 'resume' }
}

/** The automation run fields the classification reads. */
export type UnattendedAutomationRunFacts = {
  chatSessionId: string | null
  status: string
  createdAt: number
  dispatchedAt: number | null
}

const OPEN_AUTOMATION_RUN_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'dispatching',
  'dispatched'
])

/**
 * Whether a chat cut at `recordedAt` was running an automation's prompt: the newest run that
 * went to this chat before the cut is still open, or was settled as failed (the cut itself
 * settles an interrupted chat run that way). A chat whose last run completed and that a person
 * then went on with is interactive.
 */
export function chatRunsAutomation(
  sessionId: string,
  recordedAt: number,
  runs: readonly UnattendedAutomationRunFacts[]
): boolean {
  let newest: UnattendedAutomationRunFacts | null = null
  for (const run of runs) {
    if (run.chatSessionId !== sessionId) {
      continue
    }
    const at = run.dispatchedAt ?? run.createdAt
    if (at > recordedAt) {
      continue
    }
    if (!newest || at > (newest.dispatchedAt ?? newest.createdAt)) {
      newest = run
    }
  }
  return (
    newest !== null &&
    (OPEN_AUTOMATION_RUN_STATUSES.has(newest.status) || newest.status === 'dispatch_failed')
  )
}
