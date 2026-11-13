// Chat stall (FORK.md): the stalled chats main reports, held once for every mark. Subscribes to
// main only while some mark is mounted.
import { useSyncExternalStore } from 'react'
import {
  normalizeForkChatStallEntries,
  type ForkChatStallEntry
} from '../../../../shared/fork/chat-stall'

let entries: ForkChatStallEntry[] = []
const listeners = new Set<() => void>()
let unsubscribeMain: (() => void) | null = null
let pushes = 0

function apply(value: unknown): void {
  entries = normalizeForkChatStallEntries(value)
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const api = window.api?.forkChatStall
  if (!unsubscribeMain && api) {
    unsubscribeMain = api.onChanged((value) => {
      pushes += 1
      apply(value)
    })
    const before = pushes
    void api
      .list()
      // A push that arrived meanwhile is newer than this answer.
      .then((value) => pushes === before && apply(value))
      .catch(() => {})
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && unsubscribeMain) {
      unsubscribeMain()
      unsubscribeMain = null
    }
  }
}

/** The chat's stall entry, or null when it is not stalled. */
export function useForkChatStallEntry(
  sessionId: string | null | undefined
): ForkChatStallEntry | null {
  return useSyncExternalStore(subscribe, () =>
    sessionId ? (entries.find((entry) => entry.sessionId === sessionId) ?? null) : null
  )
}

/** Test seam. */
export function resetForkChatStallStore(): void {
  entries = []
  listeners.clear()
  unsubscribeMain?.()
  unsubscribeMain = null
  pushes = 0
}
