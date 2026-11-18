// Branch clashes (FORK.md, SLRM-2394): the window's copy of the last check, kept in step with main,
// which pushes every new result. Rows read marks keyed by host and worktree path.
import {
  forkClashRowMarks,
  type ForkClashResult,
  type ForkClashRowMark
} from '../../../../shared/fork/branch-clashes'

let result: ForkClashResult | null = null
let marks = new Map<string, ForkClashRowMark>()
let attached = false
const listeners = new Set<() => void>()

function api() {
  return typeof window === 'undefined' ? undefined : window.api?.forkClashes
}

function publish(next: ForkClashResult | null): void {
  result = next
  marks = forkClashRowMarks(next)
  for (const listener of listeners) {
    listener()
  }
}

function attach(): void {
  const bridge = api()
  if (attached || !bridge) {
    return
  }
  attached = true
  bridge.onChanged(publish)
  void bridge
    .get()
    .then(publish)
    .catch(() => undefined)
}

export function subscribeForkClashes(listener: () => void): () => void {
  attach()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function readForkClashMarks(): Map<string, ForkClashRowMark> {
  return marks
}

export function readForkClashResult(): ForkClashResult | null {
  return result
}

/** Asks main for a check now; the result arrives through the push. */
export function refreshForkClashes(): void {
  void api()
    ?.refresh()
    .catch(() => undefined)
}

/** Test hook: replace the window's copy. */
export function setForkClashesForTest(next: ForkClashResult | null): void {
  publish(next)
}
