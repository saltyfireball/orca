// SLRM-2099: the main process's memory warning status, held once for the whole window. The status
// cue, the popover and the launch gate read it; the main process pushes every change.
import { useSyncExternalStore } from 'react'
import type { ForkMemoryStatus } from '../../../../shared/fork/memory-truth'
import { translate } from '@/i18n/i18n'

let latest: ForkMemoryStatus | null = null
let subscribed = false
const listeners = new Set<() => void>()

function set(next: ForkMemoryStatus | null): void {
  latest = next
  for (const listener of listeners) {
    listener()
  }
}

function ensureSubscribed(): void {
  const bridge = typeof window === 'undefined' ? undefined : window.api?.forkMemory
  if (
    subscribed ||
    typeof bridge?.onChanged !== 'function' ||
    typeof bridge.getStatus !== 'function'
  ) {
    return
  }
  subscribed = true
  let pushed = false
  try {
    bridge.onChanged((status) => {
      pushed = true
      set(status)
    })
    Promise.resolve(bridge.getStatus())
      .then((status) => {
        if (!pushed && status) {
          set(status)
        }
      })
      .catch(() => undefined)
  } catch {
    // A missing or partial bridge (web client, tests) leaves the gate open.
  }
}

/** Ask main again, e.g. right after the memory settings were saved. */
export function refreshForkMemoryStatus(): void {
  ensureSubscribed()
  const bridge = typeof window === 'undefined' ? undefined : window.api?.forkMemory
  if (typeof bridge?.getStatus !== 'function') {
    return
  }
  Promise.resolve(bridge.getStatus())
    .then((status) => status && set(status))
    .catch(() => undefined)
}

export function useForkMemoryStatus(): ForkMemoryStatus | null {
  return useSyncExternalStore(
    (listener) => {
      ensureSubscribed()
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => latest
  )
}

/** Tests set the status directly. */
export function setForkMemoryStatusForTests(status: ForkMemoryStatus | null): void {
  set(status)
}

/**
 * The message to refuse a new agent launch with, or null when launches may go ahead. With the
 * launch queue on (`launchesHeld`), a native chat is not refused here: it waits in the queue. A
 * terminal agent cannot wait there, so it is still refused.
 */
export function forkMemoryLaunchRefusal(queueable = false): string | null {
  ensureSubscribed()
  if (latest?.launchesHeld === true && !queueable) {
    return translate(
      'fork.memory.launchPausedTerminal',
      'New terminal agents are paused: system memory is past the warning threshold. Chats wait in the launch queue, terminal agents cannot. Close some sessions, or turn off "Pause new agents" in Settings > Advanced > Memory.'
    )
  }
  if (latest?.launchesPaused !== true) {
    return null
  }
  return translate(
    'fork.memory.launchPaused',
    'New agents are paused: system memory is past the warning threshold. Close some sessions, or turn off "Pause new agents" in Settings > Advanced > Memory.'
  )
}
