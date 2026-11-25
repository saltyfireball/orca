// Pause all over a bot's scheduled Look around and Tidy-up (BAD-818, FORK.md "Pause all"). A slot
// that comes due while the switch is engaged (or unreadable) starts no chat: it is recorded in the
// run history as a run that ended at once with the reason. That uses the slot up, so the bot waits
// for its next slot instead of catching up the moment the switch is released. Look now and Tidy now
// are a person's and still run.
import { randomUUID } from 'node:crypto'
import type { BackgroundRuns } from '../../bots/bot-background-run-history'
import { forkPauseAllRefusal } from './pause-all-state'

export const PAUSE_ALL_SKIPPED_RUN_PREFIX = 'pause-all-skip:'

/** Why a scheduled look or tidy-up may not start now; null when it may. */
export function forkPauseAllSkipsScheduledRun(): string | null {
  return forkPauseAllRefusal()
}

/** `state` with one skipped run for the slot due now; `begin` adds a run under the history's cap. */
export function withPauseAllSkippedRun<S extends BackgroundRuns>(
  state: S,
  begin: (state: S, sessionId: string, now: number) => S,
  run: { now: number; what: 'look' | 'tidy-up'; reason: string }
): S {
  const sessionId = `${PAUSE_ALL_SKIPPED_RUN_PREFIX}${randomUUID()}`
  const begun = begin(state, sessionId, run.now)
  return {
    ...begun,
    runs: begun.runs.map((entry) =>
      entry.sessionId === sessionId
        ? {
            ...entry,
            endedAt: run.now,
            error: `The scheduled ${run.what} was skipped. ${run.reason}`,
            paused: true as const
          }
        : entry
    )
  }
}
