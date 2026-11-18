// Letters (FORK.md, SLRM-2389): when delivery passes run. Nothing runs while nothing waits: a
// send or a received letter kicks a pass at once; while letters stay queued here a pass runs
// every 5 s; while some paired server was written to in the last day its answers are collected
// every 15 s. One timer, never overlapping runs, unref'd. Started by the start-up hook on the
// desktop, `orca serve` and orcad, so a queue a restart left is picked up.
import { runForkLetterDeliveryPass } from './letters-delivery'
import {
  liveForkLetters,
  setForkLettersKick,
  setForkLettersRuntime,
  type ForkLettersDeps,
  type ForkLettersRuntime
} from './letters-deps'
import { forkLettersHavePeers, pullForkLettersFromPeers } from './letters-peers'

export const FORK_LETTERS_QUEUED_MS = 5000
export const FORK_LETTERS_PEER_POLL_MS = 15_000

export type ForkLettersRunner = { kick: () => void; stop: () => void }

/** One pass: collect from peers when due, deliver what is queued. Resolves the next delay. */
export async function forkLettersTick(
  deps: ForkLettersDeps,
  pullDue: boolean
): Promise<{ next: number | null; pulled: boolean }> {
  if (!deps.settings().letters) {
    return { next: null, pulled: false }
  }
  if (pullDue) {
    await pullForkLettersFromPeers(deps).catch(() => false)
  }
  const queued = await runForkLetterDeliveryPass(deps.store, deps.ports(), deps.now)
  const peers = forkLettersHavePeers((await deps.store.read()).peers, deps.now())
  return {
    next: queued > 0 ? FORK_LETTERS_QUEUED_MS : peers ? FORK_LETTERS_PEER_POLL_MS : null,
    pulled: pullDue
  }
}

export function createForkLettersRunner(deps: ForkLettersDeps): ForkLettersRunner {
  let timer: ReturnType<typeof setTimeout> | undefined
  let dueAt = Infinity
  let running = false
  let again = false
  let lastPull = 0
  let stopped = false

  const arm = (delay: number): void => {
    if (stopped) {
      return
    }
    const at = deps.now() + delay
    if (timer && at >= dueAt) {
      return
    }
    if (timer) {
      clearTimeout(timer)
    }
    dueAt = at
    timer = setTimeout(run, delay)
    timer.unref?.()
  }
  const run = (): void => {
    timer = undefined
    dueAt = Infinity
    if (running) {
      again = true
      return
    }
    running = true
    const pullDue = deps.now() - lastPull >= FORK_LETTERS_PEER_POLL_MS
    void forkLettersTick(deps, pullDue)
      .then(
        ({ next, pulled }) => {
          if (pulled) {
            lastPull = deps.now()
          }
          return next
        },
        (error: unknown) => {
          console.warn('[fork-letters] delivery pass failed:', error)
          return FORK_LETTERS_PEER_POLL_MS
        }
      )
      .then((next) => {
        running = false
        if (again) {
          again = false
          arm(0)
        } else if (next !== null) {
          arm(next)
        }
      })
  }
  return {
    kick: () => arm(0),
    stop: () => {
      stopped = true
      if (timer) {
        clearTimeout(timer)
      }
    }
  }
}

let runner: ForkLettersRunner | null = null

/** Start-up hook: hands over the runtime and runs one pass for a queue a restart left. */
export function startForkLetters(runtime: ForkLettersRuntime): void {
  setForkLettersRuntime(runtime)
  ensureForkLettersRunner().kick()
}

export function ensureForkLettersRunner(): ForkLettersRunner {
  if (!runner) {
    const deps = liveForkLetters()
    runner = process.env.VITEST ? { kick: () => {}, stop: () => {} } : createForkLettersRunner(deps)
    setForkLettersKick(runner.kick)
  }
  return runner
}
