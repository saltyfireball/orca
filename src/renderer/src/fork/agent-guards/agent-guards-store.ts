// Agent guards (FORK.md, SLRM-2385): the guarded agents main reports, held once for every status
// line and for the Decision inbox's button. Subscribes to main only while one of them is mounted.
import { useSyncExternalStore } from 'react'
import {
  normalizeAgentGuardEntries,
  type AgentGuardEntry
} from '../../../../shared/fork/agent-guards'
import { sleeperChatSessionId } from '../../../../shared/fork/sleepers-ps-sources'

let entries: AgentGuardEntry[] = []
const listeners = new Set<() => void>()
let unsubscribeMain: (() => void) | null = null
let pushes = 0

function apply(value: unknown): void {
  entries = normalizeAgentGuardEntries(value)
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const api = window.api?.forkAgentGuards
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

/** The entry a status line shows: warned or paused only (a cap under its limit shows nothing). */
export function findAgentGuardEntry(
  list: readonly AgentGuardEntry[],
  subject: { paneKey?: string | null; sessionId?: string | null; tabId?: string | null }
): AgentGuardEntry | null {
  const sessionId =
    subject.sessionId ?? (subject.paneKey ? sleeperChatSessionId(subject.paneKey) : null)
  return (
    list.find(
      (entry) =>
        entry.state !== 'capped' &&
        ((sessionId && entry.sessionId === sessionId) ||
          (subject.paneKey && entry.paneKey === subject.paneKey) ||
          (subject.tabId &&
            entry.kind === 'terminal' &&
            entry.paneKey?.startsWith(`${subject.tabId}:`)))
    ) ?? null
  )
}

export function useForkAgentGuardEntry(subject: {
  paneKey?: string | null
  sessionId?: string | null
  tabId?: string | null
}): AgentGuardEntry | null {
  return useSyncExternalStore(subscribe, () => findAgentGuardEntry(entries, subject))
}

function pausedCount(): number {
  return entries.filter((entry) => entry.state === 'paused').length
}

/** Paused agents on this desktop, for the Decision inbox's button while idle recovery is off. */
export function useForkAgentGuardPausedCount(): number {
  return useSyncExternalStore(subscribe, pausedCount)
}

export function forkAgentGuardPausedCount(): number {
  return pausedCount()
}

/** Test seam. */
export function resetForkAgentGuardsStore(): void {
  entries = []
  listeners.clear()
  unsubscribeMain?.()
  unsubscribeMain = null
  pushes = 0
}
