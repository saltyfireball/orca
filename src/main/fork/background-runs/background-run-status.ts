// Background runs never wait on the owner (FORK.md "Needs you list", BAD-795). A bot's look-around
// or tidy-up is a hidden chat nobody can open, so its status never says it waits for an answer: the
// row, its picture's badge, the status bar, the popover, the dashboard and the phone all read the
// published status. A run that fails or stops in time shows on the bot's Look around row.
import type { AgentSessionStatusSummary } from '../../../shared/agent-session/agent-session-wire'

type BackgroundRunOf = (sessionId: string) => unknown

let backgroundRunOf: BackgroundRunOf | null = null

/** Keeps the host's own answer to "is this a read-only background run", handed back unchanged. */
export function forkNoteBackgroundRuns<T extends BackgroundRunOf>(read: T): T {
  backgroundRunOf = read
  return read
}

export function isForkBackgroundRun(sessionId: string): boolean {
  return Boolean(backgroundRunOf?.(sessionId))
}

/** The summary as published: a background run's without anything that asks the owner. */
export function forkPublishedStatusSummary(
  summary: AgentSessionStatusSummary
): AgentSessionStatusSummary {
  if (!isForkBackgroundRun(summary.sessionId)) {
    return summary
  }
  const {
    awaitsAnswer: _awaitsAnswer,
    awaitsQuestion: _awaitsQuestion,
    awaitsApproval: _awaitsApproval,
    awaitsBlockingQuestion: _awaitsBlockingQuestion,
    attentionAsksOnlyQuestions: _attentionAsksOnlyQuestions,
    ...quiet
  } = summary
  if (quiet.status !== 'attention') {
    return quiet
  }
  // Still running, as far as the run's own time limit is concerned; with no process it is over.
  return { ...quiet, status: quiet.hostExecutionOwned ? 'working' : 'idle' }
}
