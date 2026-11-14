// Idle recovery (FORK.md), item B: which chats the sweep looks at.
// Contract: list this host's native chats and terminal agents whose turn has ended and that
// have been idle for at least `settings.idleSeconds`, with the facts the wake rules need. Skip
// sub-agents, chats in a turn, and workers unless `settings.workers` is 'include'. Read only:
// never send to, wake or stop a chat from here.
import type { IdleRecoverySettings } from '../../../shared/fork/idle-recovery-settings'
import type { IdleRecoveryCandidate } from './idle-recovery-types'

export async function listIdleRecoveryCandidates(
  _settings: IdleRecoverySettings,
  _nowMs: number
): Promise<IdleRecoveryCandidate[]> {
  return []
}
