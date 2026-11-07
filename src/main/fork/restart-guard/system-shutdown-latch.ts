// Remembers an OS shutdown or logout long enough for its quit to pass the guard. It clears after
// a minute (or on resume), so a logout the user cancelled does not turn the guard off for good.
export const SYSTEM_SHUTDOWN_LATCH_MS = 60_000

export type SystemShutdownLatch = {
  mark: () => void
  reset: () => void
  isSet: () => boolean
}

export function createSystemShutdownLatch(
  schedule: (run: () => void, ms: number) => () => void
): SystemShutdownLatch {
  let set = false
  let cancel: (() => void) | null = null
  const reset = (): void => {
    cancel?.()
    cancel = null
    set = false
  }
  return {
    mark: () => {
      reset()
      set = true
      cancel = schedule(reset, SYSTEM_SHUTDOWN_LATCH_MS)
    },
    reset,
    isSet: () => set
  }
}
