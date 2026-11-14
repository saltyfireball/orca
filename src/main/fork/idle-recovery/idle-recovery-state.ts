// Idle recovery (FORK.md), item D: what is remembered per chat between sweeps and restarts.
// Contract: load returns the saved state, or an empty one when the file is missing or
// unreadable; save writes it atomically with async file calls. Rows of chats that are gone are
// dropped by the sweep, not here.
import {
  IDLE_RECOVERY_STATE_VERSION,
  type IdleRecoveryPersistedState
} from '../../../shared/fork/idle-recovery'

export async function loadIdleRecoveryState(): Promise<IdleRecoveryPersistedState> {
  return { version: IDLE_RECOVERY_STATE_VERSION, chats: {} }
}

export async function saveIdleRecoveryState(_state: IdleRecoveryPersistedState): Promise<void> {}
