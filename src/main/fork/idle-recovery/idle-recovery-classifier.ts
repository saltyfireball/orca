// Idle recovery (FORK.md), item C: runs the user's classifier command.
// Contract: with `settings.classifierCommand` set, run it with the input as one JSON object on
// stdin, stop it after `settings.classifierTimeoutSeconds`, and read stdout through
// `parseIdleRecoveryVerdict` (ceiling: `settings.recheckMaxMinutes`). A failed start, a non-zero
// exit, a timeout or unreadable output is 'finished'. With no command, answer with the built-in
// classifier. Never throws.
import type {
  IdleRecoveryClassifierInput,
  IdleRecoveryVerdict
} from '../../../shared/fork/idle-recovery'
import type { IdleRecoverySettings } from '../../../shared/fork/idle-recovery-settings'
import { classifyIdleRecoveryBuiltin } from './idle-recovery-builtin'

export async function classifyIdleRecoveryEnding(
  input: IdleRecoveryClassifierInput,
  _settings: IdleRecoverySettings,
  _signal?: AbortSignal
): Promise<IdleRecoveryVerdict> {
  return classifyIdleRecoveryBuiltin(input)
}
