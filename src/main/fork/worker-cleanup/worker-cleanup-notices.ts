// Worker cleanup (FORK.md): the notices a sweep raised, kept for Undo, and the held list. The
// desktop bridge sets the publisher; without one (a server, a test) nothing is sent.
import { randomUUID } from 'node:crypto'
import type {
  ForkWorkerCleanupHeld,
  ForkWorkerCleanupItem,
  ForkWorkerCleanupNotice
} from '../../../shared/fork/worker-cleanup'

/** Notices kept for Undo; an older one can no longer be undone from its toast. */
const MAX_NOTICES = 20

export type WorkerCleanupPublisher = {
  notice: (notice: ForkWorkerCleanupNotice) => void
  held: (held: ForkWorkerCleanupHeld[]) => void
}

const notices = new Map<string, ForkWorkerCleanupItem[]>()
let held: ForkWorkerCleanupHeld[] = []
let heldKey = ''
let publisher: WorkerCleanupPublisher | null = null

export function setWorkerCleanupPublisher(next: WorkerCleanupPublisher | null): void {
  publisher = next
}

export function rememberNotice(items: ForkWorkerCleanupItem[]): ForkWorkerCleanupNotice {
  const notice = { id: randomUUID(), items }
  notices.set(notice.id, items)
  while (notices.size > MAX_NOTICES) {
    const oldest = notices.keys().next().value
    if (oldest === undefined) {
      break
    }
    notices.delete(oldest)
  }
  return notice
}

/** The items of a notice, once: a second Undo of the same toast finds nothing. */
export function takeNotice(id: string): ForkWorkerCleanupItem[] {
  const items = notices.get(id) ?? []
  notices.delete(id)
  return items
}

export function publishWorkerCleanup(notice: ForkWorkerCleanupNotice): void {
  publisher?.notice(notice)
}

/** Replace the held list; windows hear only a real change. */
export function setWorkerCleanupHeld(next: ForkWorkerCleanupHeld[]): void {
  const key = JSON.stringify(next)
  if (key === heldKey) {
    return
  }
  held = next
  heldKey = key
  publisher?.held(held)
}

export function readWorkerCleanupHeld(): ForkWorkerCleanupHeld[] {
  return held
}

/** Test seam. */
export function resetWorkerCleanupNotices(): void {
  notices.clear()
  held = []
  heldKey = ''
  publisher = null
}
