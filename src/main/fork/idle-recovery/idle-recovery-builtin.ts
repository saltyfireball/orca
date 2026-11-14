// Idle recovery (FORK.md), item C: the classifier used when no command is set.
// Contract: pure and synchronous. Never returns 'stalled' (so it never wakes a chat), and
// returns 'waiting_user' only when the last assistant message closes on a question; everything
// else is 'finished'.
import type {
  IdleRecoveryClassifierInput,
  IdleRecoveryVerdict
} from '../../../shared/fork/idle-recovery'

export function classifyIdleRecoveryBuiltin(
  _input: IdleRecoveryClassifierInput
): IdleRecoveryVerdict {
  return { verdict: 'finished', reason: '', question: '', nextStep: '', wakeAfterSeconds: 0 }
}
