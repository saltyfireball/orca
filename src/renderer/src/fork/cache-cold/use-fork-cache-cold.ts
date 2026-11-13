// SLRM-2103 (FORK.md "Usage ledger and cache-cold cue"): the main process's prompt cache states,
// shared by every composer cue and row mark through one subscription, and the verdict for one
// chat, re-checked when its window runs out.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import {
  forkCacheColdConfig,
  forkCacheColdInMs,
  forkCacheColdVerdict,
  type ForkCacheColdVerdict,
  type ForkCacheState
} from '../../../../shared/fork/usage-ledger'

let states = new Map<string, ForkCacheState>()
const listeners = new Set<() => void>()
let stopBridge: (() => void) | null = null

function publish(next: ForkCacheState[]): void {
  states = new Map(next.map((state) => [state.sessionId, state]))
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Absent in tests and in windows without the preload bridge.
  const bridge = window.api?.forkUsageLedger
  if (bridge && !stopBridge) {
    let pushed = false
    const off = bridge.onCacheChanged((next) => {
      pushed = true
      publish(next)
    })
    stopBridge = off
    void bridge
      .cacheStates()
      .then((current) => {
        // A push that arrived first is newer than this answer.
        if (!pushed && stopBridge === off) {
          publish(current)
        }
      })
      .catch(() => undefined)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && stopBridge) {
      stopBridge()
      stopBridge = null
      states = new Map()
    }
  }
}

function useCacheState(sessionId: string | undefined): ForkCacheState | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (sessionId ? states.get(sessionId) : undefined),
    () => undefined
  )
}

/** Whether this chat's prompt cache is likely cold, and how many tokens a send would re-read. */
export function useForkCacheCold(sessionId: string | undefined): ForkCacheColdVerdict {
  const settings = useAppStore((s) => s.settings)
  const state = useCacheState(sessionId)
  const config = forkCacheColdConfig(settings ?? undefined)
  const [now, setNow] = useState(() => Date.now())
  const waitMs = forkCacheColdInMs(state, config, now)
  useEffect(() => {
    if (waitMs === null || waitMs <= 0) {
      return undefined
    }
    // One timer per chat, set to the moment its window runs out (plus a beat for clock skew).
    const timer = setTimeout(() => setNow(Date.now()), Math.min(waitMs + 1000, 2 ** 31 - 1))
    return () => clearTimeout(timer)
  }, [waitMs])
  // A new state (a send, a reply) must be judged against the current clock, not the last tick.
  useEffect(() => setNow(Date.now()), [state])
  return forkCacheColdVerdict(state, config, now)
}
