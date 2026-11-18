// Limit resume (FORK.md, SLRM-2309): the parked chats and terminal agents main reports, held once
// for every label. Subscribes to main only while some label is mounted.
import { useSyncExternalStore } from 'react'
import {
  normalizeLimitResumeEntries,
  type LimitResumeEntry
} from '../../../../shared/fork/limit-resume'

let entries: LimitResumeEntry[] = []
const listeners = new Set<() => void>()
let unsubscribeMain: (() => void) | null = null
let pushes = 0

function apply(value: unknown): void {
  entries = normalizeLimitResumeEntries(value)
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const api = window.api?.forkLimitResume
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

/** Only an entry that will still resume by itself gets a label. */
const resumes = (entry: LimitResumeEntry): boolean =>
  entry.state === 'parked' || entry.state === 'held'

/** The entry for an agent row's pane, a native chat, or any pane of a terminal tab. */
export function findLimitResumeEntry(
  list: readonly LimitResumeEntry[],
  subject: { paneKey?: string | null; sessionId?: string | null; tabId?: string | null }
): LimitResumeEntry | null {
  return (
    list.find(
      (entry) =>
        resumes(entry) &&
        ((subject.paneKey && entry.paneKey === subject.paneKey) ||
          (subject.sessionId && entry.sessionId === subject.sessionId) ||
          (subject.tabId &&
            entry.kind === 'terminal' &&
            entry.paneKey.startsWith(`${subject.tabId}:`)))
    ) ?? null
  )
}

export function useForkLimitResumeEntry(subject: {
  paneKey?: string | null
  sessionId?: string | null
  tabId?: string | null
}): LimitResumeEntry | null {
  return useSyncExternalStore(subscribe, () => findLimitResumeEntry(entries, subject))
}

/** Every entry main reports (SLRM-2391's handoff offer reads them all). */
export function useForkLimitResumeEntries(): readonly LimitResumeEntry[] {
  return useSyncExternalStore(subscribe, () => entries)
}

/** Test seam. */
export function resetForkLimitResumeStore(): void {
  entries = []
  listeners.clear()
  unsubscribeMain?.()
  unsubscribeMain = null
  pushes = 0
}
