// Idle recovery (FORK.md), item B: reads how a candidate's conversation ended.
// Contract: return the last request and the last assistant message of the chat (the caller
// cuts the tail and fingerprints it), or null when the ending cannot be read; a null ending is
// never classified. Read only.
import type { IdleRecoveryCandidate, IdleRecoveryEnding } from './idle-recovery-types'

export async function readIdleRecoveryEnding(
  _candidate: IdleRecoveryCandidate
): Promise<IdleRecoveryEnding | null> {
  return null
}
