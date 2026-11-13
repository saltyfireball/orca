// SLRM-2138: a check for a process that can only be watched by asking (no event says it is
// gone). It runs after `firstMs`, then at doubling gaps up to `maxMs`, and stops once the check
// says it is done or the returned stop is called. Plain Node: the broker process loads it too.

export function chatSurviveBackoffPoll(
  check: () => boolean,
  firstMs: number,
  maxMs: number
): () => void {
  let timer: NodeJS.Timeout | null = null
  let stopped = false
  const next = (delay: number): void => {
    timer = setTimeout(() => {
      timer = null
      if (!stopped && !check()) {
        next(Math.min(delay * 2, maxMs))
      }
    }, delay)
    // A watch never keeps its process alive on its own.
    timer.unref?.()
  }
  next(firstMs)
  return () => {
    stopped = true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
}
