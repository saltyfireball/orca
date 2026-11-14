// Idle recovery (FORK.md), item D: the two ways it sends to a chat.
// Contract: a wake goes out only after `decideIdleRecoveryWake` said 'wake', as
// `buildIdleRecoveryWakeMessage(nextStep)`, and resolves true only when the chat took it. An
// answer is the user's own text, sent unchanged to a chat that is waiting on the user. Both use
// the app's normal send for that kind of chat.
import type { ForkIdleRecoveryAnswerOutcome } from '../../../shared/fork/idle-recovery-wire'
import type { IdleRecoveryCandidate } from './idle-recovery-types'

export async function sendIdleRecoveryWake(
  _candidate: IdleRecoveryCandidate,
  _nextStep: string
): Promise<boolean> {
  return false
}

export async function sendIdleRecoveryAnswer(
  _chatId: string,
  _text: string
): Promise<ForkIdleRecoveryAnswerOutcome> {
  return 'unavailable'
}
