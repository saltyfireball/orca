// Pooled limits (FORK.md, SLRM-2392): the usage popover and /usage-limits read this machine's
// fork.limits.usage, which asks the paired servers. One answer is shared for a short while so
// opening the popover again does not ask every server again.
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type { ForkPooledLimitsResult } from '../../../../shared/fork/pooled-limits'

const LOCAL = { kind: 'local' } as const
const FRESH_MS = 30_000
const TIMEOUT_MS = 45_000

type State = {
  result: ForkPooledLimitsResult | null
  loading: boolean
  error: boolean
  readAt: number
}

let state: State = { result: null, loading: false, error: false, readAt: 0 }
let inFlight: Promise<void> | null = null
const listeners = new Set<() => void>()

function set(next: Partial<State>): void {
  state = { ...state, ...next }
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Reads again unless a fresh answer is at hand; `refresh` also has every machine read usage again. */
export function loadForkPooledLimits(
  options: { force?: boolean; refresh?: boolean } = {}
): Promise<void> {
  if (inFlight) {
    return inFlight
  }
  if (!options.force && !options.refresh && Date.now() - state.readAt < FRESH_MS) {
    return Promise.resolve()
  }
  set({ loading: true })
  inFlight = callRuntimeRpc<ForkPooledLimitsResult>(
    LOCAL,
    'fork.limits.usage',
    options.refresh ? { refresh: true } : {},
    { timeoutMs: TIMEOUT_MS }
  )
    .then(
      (result) => set({ result, loading: false, error: false, readAt: Date.now() }),
      () => set({ loading: false, error: true, readAt: Date.now() })
    )
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/** Tests only. */
export function resetForkPooledLimitsForTests(): void {
  state = { result: null, loading: false, error: false, readAt: 0 }
  inFlight = null
}

export function useForkPooledLimits(active: boolean): State & { reload: () => void } {
  const current = useSyncExternalStore(subscribe, () => state)
  useEffect(() => {
    if (active) {
      void loadForkPooledLimits()
    }
  }, [active])
  const reload = useCallback(() => void loadForkPooledLimits({ refresh: true }), [])
  return { ...current, reload }
}
