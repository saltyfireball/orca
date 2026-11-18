// Agent guards (FORK.md, SLRM-2385): which agents a guard has paused, for the fork's own automatic
// senders to leave alone (idle recovery's wake, limit resume, unattended resume). In memory, kept
// by the guard service from its saved state. No imports, so any fork module may ask.

let held: ReadonlySet<string> = new Set()

/** A native chat's session id or a terminal agent's pane key. */
export function isForkAgentGuardHeld(id: string): boolean {
  return held.has(id)
}

export function setForkAgentGuardHeld(ids: Iterable<string>): void {
  held = new Set(ids)
}
