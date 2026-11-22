// Auto-continue filter (FORK.md, BAD-560): upstream's launch continuation continues every chat a
// restart cut. Blackfish keeps that for work nobody is watching (an orchestration worker with an
// open dispatch, the chat of an automation run) and leaves a person's own chats to the restart
// offer, unless `forkAutoContinueInteractive` is on.
import type { ForkGlobalSettings } from './fork-global-settings'

/** Any settings object; a hand-edited file cannot break the reader. */
export type AutoContinueSettingsSource =
  | Partial<Pick<ForkGlobalSettings, 'forkAutoContinueInteractive'>>
  | null
  | undefined

export function autoContinueInteractiveOn(settings: AutoContinueSettingsSource): boolean {
  return settings?.forkAutoContinueInteractive === true
}

/** The automation run fields the classification reads. */
export type AutoContinueAutomationRunFacts = {
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
  runs: readonly AutoContinueAutomationRunFacts[]
): boolean {
  let newest: AutoContinueAutomationRunFacts | null = null
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
