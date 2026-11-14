// Idle recovery (FORK.md), item E1: how `orca inbox` prints what the host answers.
// Contract: pure text formatting of the `idle-recovery-wire.ts` results; --json bypasses it.
import type {
  ForkIdleRecoveryAnswerResult,
  ForkIdleRecoveryInboxResult,
  ForkIdleRecoveryPauseResult
} from '../../shared/fork/idle-recovery-wire'

export function formatInboxList(result: ForkIdleRecoveryInboxResult): string {
  if (result.mode === 'off') {
    return 'Idle recovery is off on this host.'
  }
  return result.items.length === 0
    ? 'No chats are waiting on you.'
    : `${result.items.length} chats.`
}

export function formatInboxAnswer(result: ForkIdleRecoveryAnswerResult): string {
  return `${result.chatId}: ${result.result}`
}

export function formatInboxPause(result: ForkIdleRecoveryPauseResult): string {
  if (!result.saved) {
    return `${result.chatId}: not saved`
  }
  return `${result.chatId}: ${result.paused ? 'paused' : 'resumed'}`
}
