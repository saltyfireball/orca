// What app:relaunch and app:restart resolve to when the restart guard holds the restart, so the
// renderer can tell a held restart from a failed one (FORK.md "Restart guard").
export type ForkRestartHeld = { forkRestartHeld: 'waiting' | 'cancelled' }

export function isForkRestartHeld(value: unknown): value is ForkRestartHeld {
  if (typeof value !== 'object' || value === null || !('forkRestartHeld' in value)) {
    return false
  }
  const held: unknown = value.forkRestartHeld
  return held === 'waiting' || held === 'cancelled'
}
