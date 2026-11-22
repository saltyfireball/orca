// Goal loop (BAD-682, FORK.md): goals that stopped without being met, as Decision inbox rows. A
// goal that was met, cleared or whose agent closed needs nobody. A row leaves when it is dismissed
// (Stop in the inbox) or a day after the goal stopped.
import { describeGoalUntil, goalStopTitle, type GoalRecord } from '../../../shared/fork/goal-loop'
import type { ForkIdleRecoveryInboxItem } from '../../../shared/fork/idle-recovery-wire'

export const GOAL_ROW_PREFIX = 'goal:'

export function goalInboxItems(goals: readonly GoalRecord[]): ForkIdleRecoveryInboxItem[] {
  return goals.flatMap((goal): ForkIdleRecoveryInboxItem[] => {
    const stop = goal.stop
    if (goal.status !== 'stopped' || !stop || ['met', 'cleared', 'gone'].includes(stop.reason)) {
      return []
    }
    return [
      {
        chatId: `${GOAL_ROW_PREFIX}${goal.id}`,
        kind: goal.kind,
        agent: goal.agent,
        title: goal.title || goalStopTitle(stop.reason),
        workspace: '',
        worktreeId: goal.worktreeId,
        verdict: 'stalled',
        question: '',
        reason: `${goalStopTitle(stop.reason)}. ${stop.text} The goal was ${describeGoalUntil(goal.until)}. Rounds used: ${goal.rounds}. Details: orca goal list`,
        since: stop.at,
        wakes: 0,
        wakeAt: null,
        paused: false,
        source: 'goal'
      }
    ]
  })
}
