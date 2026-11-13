// SLRM-2098 (FORK.md "Agent launch queue"): the main process's queue, shared by every queued
// banner and tab badge through one subscription.
import { useSyncExternalStore } from 'react'
import type {
  ForkAgentQueueEntry,
  ForkAgentQueueSnapshot
} from '../../../../shared/fork/agent-queue'

let snapshot: ForkAgentQueueSnapshot | null = null
const listeners = new Set<() => void>()
let stopBridge: (() => void) | null = null

function publish(next: ForkAgentQueueSnapshot): void {
  snapshot = next
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Absent in tests and in windows without the preload bridge.
  const bridge = window.api?.forkAgentQueue
  if (bridge && !stopBridge) {
    let pushed = false
    const off = bridge.onChanged((next) => {
      pushed = true
      publish(next)
    })
    stopBridge = off
    void bridge
      .get()
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
      snapshot = null
    }
  }
}

function read(): ForkAgentQueueSnapshot | null {
  return snapshot
}

/** This chat's place in the agent queue, or null while it is not waiting. */
export function useForkQueuedLaunch(sessionId: string | undefined): ForkAgentQueueEntry | null {
  const current = useSyncExternalStore(subscribe, read, read)
  if (!sessionId || !current) {
    return null
  }
  return current.entries.find((entry) => entry.sessionId === sessionId) ?? null
}
