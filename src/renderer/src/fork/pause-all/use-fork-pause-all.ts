// Pause all (BAD-685, FORK.md "Pause all"): this desktop's own switch, read from its runtime
// (fork.pauseAll.status) on a slow poll, and changed through fork.pauseAll.set, which the runtime
// fans out to its paired servers. One shared poll serves every mounted reader.
import { useCallback, useSyncExternalStore } from 'react'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import {
  FORK_PAUSE_ALL_SERVER_TIMEOUT_MS,
  FORK_PAUSE_ALL_SET_METHOD,
  FORK_PAUSE_ALL_STATUS_METHOD,
  type ForkPauseAllResult,
  type ForkPauseAllState
} from '../../../../shared/fork/pause-all'

const POLL_MS = 5_000
const CALL_TIMEOUT_MS = FORK_PAUSE_ALL_SERVER_TIMEOUT_MS + 4_000

let current: ForkPauseAllState | null = null
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function publish(next: ForkPauseAllState | null): void {
  if (JSON.stringify(next) === JSON.stringify(current)) {
    return
  }
  current = next
  for (const listener of listeners) {
    listener()
  }
}

async function refresh(): Promise<void> {
  try {
    const result = await callRuntimeRpc<ForkPauseAllResult>(
      { kind: 'local' },
      FORK_PAUSE_ALL_STATUS_METHOD,
      {},
      { timeoutMs: CALL_TIMEOUT_MS }
    )
    publish(result.state)
  } catch {
    // A host without pause-all (or one that does not answer) shows no toggle's state.
    publish(null)
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!timer) {
    void refresh()
    timer = setInterval(() => void refresh(), POLL_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
      current = null
    }
  }
}

/** This host's pause-all state, or null before it is read or where the host has no pause-all. */
export function useForkPauseAllState(): ForkPauseAllState | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current
  )
}

/** Engages or releases the switch here and on paired servers; resolves with what each server said. */
export function useForkPauseAllToggle(): (engaged: boolean) => Promise<ForkPauseAllResult> {
  return useCallback(async (engaged: boolean) => {
    const result = await callRuntimeRpc<ForkPauseAllResult>(
      { kind: 'local' },
      FORK_PAUSE_ALL_SET_METHOD,
      { engaged },
      { timeoutMs: CALL_TIMEOUT_MS * 2 }
    )
    publish(result.state)
    return result
  }, [])
}
