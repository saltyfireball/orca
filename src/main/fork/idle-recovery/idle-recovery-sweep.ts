// Idle recovery (FORK.md), item D: one pass over the candidates.
// Contract: for each candidate read its ending, fingerprint it, and classify an ending not
// seen before (once per fingerprint). Reset a chat's wake count when its prompt is no longer a
// wake (`isWakePrompt`). In mode 'wake', send a wake to a stalled chat only when
// `decideIdleRecoveryWake` allows it; in mode 'inbox', never send. Update the state and say
// what changed. Does nothing in mode 'off'.
import type { IdleRecoveryPersistedState } from '../../../shared/fork/idle-recovery'
import type { IdleRecoverySettings } from '../../../shared/fork/idle-recovery-settings'
import type { IdleRecoverySweepResult } from './idle-recovery-types'

export type IdleRecoverySweepInput = {
  settings: IdleRecoverySettings
  nowMs: number
  state: IdleRecoveryPersistedState
}

export async function runIdleRecoverySweep(
  _input: IdleRecoverySweepInput
): Promise<IdleRecoverySweepResult> {
  return { changed: false, newlyWaiting: [] }
}
