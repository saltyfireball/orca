// BAD-764: a chat's call made before the command guards start waits for them: the app is starting,
// and what may be refused must not slip through. The wait is bounded and shared, so the calls of a
// host that never starts the guards (it has none) are held up once at most and then go through, as
// they did before the hook was always attached.
export const COMMAND_GUARD_START_WAIT_MS = 10_000

let waitMs = COMMAND_GUARD_START_WAIT_MS
let waiting: { started: Promise<boolean>; settle: (started: boolean) => void } | null = null

/** True once the guards start, false when the wait is over without them. */
export function waitForCommandGuardStart(): Promise<boolean> {
  if (!waiting) {
    const { promise, resolve } = Promise.withResolvers<boolean>()
    const timer = setTimeout(() => {
      console.warn('[fork-command-guards] not started on this host; calls of its chats go through')
      resolve(false)
    }, waitMs)
    timer.unref?.()
    waiting = {
      started: promise,
      settle: (started) => {
        clearTimeout(timer)
        resolve(started)
      }
    }
  }
  return waiting.started
}

export function settleCommandGuardStart(): void {
  waiting?.settle(true)
}

/** The guards stopped: calls that waited go through, and the next call waits anew. */
export function resetCommandGuardStart(nextWaitMs = COMMAND_GUARD_START_WAIT_MS): void {
  waitMs = nextWaitMs
  waiting?.settle(false)
  waiting = null
}
