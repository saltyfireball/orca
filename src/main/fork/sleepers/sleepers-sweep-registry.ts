// Sleepers (FORK.md): the chat host's idle sweep hands itself here when it is built, so "sleep
// now" runs the very sweep that releases idle chats, with all of its owed-work checks.

export type ForkSleepersSweep = {
  sweepNow: (sessionId: string) => Promise<void>
}

let attached: ForkSleepersSweep | null = null

export function attachForkSleepersSweep(sweep: ForkSleepersSweep): void {
  attached = sweep
}

export function forkSleepersSweep(): ForkSleepersSweep | null {
  return attached
}

/** Test seam. */
export function resetForkSleepersSweep(): void {
  attached = null
}
