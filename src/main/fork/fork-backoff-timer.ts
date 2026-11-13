// A repeating timer for fork main-process sweeps that backs off while there is nothing to do,
// instead of a fixed-cadence setInterval (config/recurring-timer-baseline.txt ratchets those).
// Each run reports whether it had work: with work the next run is `baseMs` away, without it the
// wait doubles up to `maxMs`. Runs never overlap; the next wait starts when a run settles. The
// timer is unref'd, so it never keeps the process alive.

export type ForkBackoffTimerOptions = {
  /** Resolves true when the run had work to do (the cadence goes back to `baseMs`). */
  run: () => Promise<boolean>
  baseMs: number
  maxMs: number
  onError?: (error: unknown) => void
}

/** Starts the timer (first run `baseMs` from now) and returns its stop function. */
export function startForkBackoffTimer(options: ForkBackoffTimerOptions): () => void {
  let delayMs = options.baseMs
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const arm = (): void => {
    if (stopped) {
      return
    }
    timer = setTimeout(tick, delayMs)
    timer.unref?.()
  }
  const settle = (hadWork: boolean): void => {
    delayMs = hadWork ? options.baseMs : Math.min(delayMs * 2, options.maxMs)
    arm()
  }
  const tick = (): void => {
    timer = undefined
    let pending: Promise<boolean>
    try {
      pending = options.run()
    } catch (error) {
      pending = Promise.reject(error)
    }
    pending.then(settle, (error: unknown) => {
      options.onError?.(error)
      // A failing run keeps the base cadence, as a fixed interval would have retried.
      settle(true)
    })
  }

  arm()
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
