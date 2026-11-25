// Goal loop (BAD-682, BAD-822): how a goal whose agent is not running any more ends.
import type { GoalRecord, GoalStopReason } from '../../../shared/fork/goal-loop'

export function finishGoal(
  goal: GoalRecord,
  now: number,
  reason: GoalStopReason,
  text: string
): void {
  goal.status = 'stopped'
  goal.stop = { reason, text, at: now }
}

/** Quiet only with a recorded cause: a person's close, or a worker that reported done. */
export function endMissingGoal(
  goal: GoalRecord,
  deps: {
    now: () => number
    workerFinished: (id: string) => boolean
    notifyStopped: (goal: GoalRecord) => void
  }
): void {
  if (goal.closedAt !== undefined) {
    finishGoal(goal, deps.now(), 'gone', 'The agent was closed.')
  } else if (deps.workerFinished(goal.id)) {
    finishGoal(goal, deps.now(), 'gone', 'The worker reported done and its agent ended.')
  } else {
    finishGoal(
      goal,
      deps.now(),
      'agent-lost',
      'The agent stopped running and nobody closed it: it exited, crashed or was killed, or did not come back after a restart.'
    )
    deps.notifyStopped(goal)
  }
}
