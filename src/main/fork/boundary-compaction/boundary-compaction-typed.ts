// Boundary compaction (FORK.md): which native chats hold text in their message box, as each
// window reports it. A draft lives only in the window, so the sweep cannot read it itself. Kept
// apart from the bridge so the service never imports electron.
import { normalizeForkBoundaryCompactionTyped } from '../../../shared/fork/boundary-compaction'

const typedBySource = new Map<number, ReadonlySet<string>>()

/** Replaces one window's list. */
export function setForkBoundaryCompactionTyped(sourceId: number, ids: unknown): void {
  typedBySource.set(sourceId, new Set(normalizeForkBoundaryCompactionTyped(ids)))
}

/** A closed window reports nothing more; its list is dropped. */
export function clearForkBoundaryCompactionTyped(sourceId?: number): void {
  if (sourceId === undefined) {
    typedBySource.clear()
  } else {
    typedBySource.delete(sourceId)
  }
}

/**
 * Whether any window holds text for this chat. Null while no window has reported: then nobody
 * knows what the message boxes hold, and the sweep leaves every chat alone.
 */
export function forkBoundaryCompactionTyped(sessionId: string): boolean | null {
  if (typedBySource.size === 0) {
    return null
  }
  for (const ids of typedBySource.values()) {
    if (ids.has(sessionId)) {
      return true
    }
  }
  return false
}
