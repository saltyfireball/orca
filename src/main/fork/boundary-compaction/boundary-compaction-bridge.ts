// Boundary compaction (FORK.md): the one entry `src/main/index.ts` calls. It takes each window's
// report of the chats whose message box holds text, and starts the sweep's timer. Kept apart
// from the service so the sweep never imports electron.
import { ipcMain } from 'electron'
import { FORK_BOUNDARY_COMPACTION_CHANNELS } from '../../../shared/fork/boundary-compaction'
import {
  startForkBoundaryCompactionService,
  type BoundaryCompactionSettingsReader,
  type BoundaryCompactionStartHooks
} from './boundary-compaction-service'
import {
  clearForkBoundaryCompactionTyped,
  setForkBoundaryCompactionTyped
} from './boundary-compaction-typed'

let installed = false

export function startForkBoundaryCompaction(
  reader: BoundaryCompactionSettingsReader,
  hooks?: BoundaryCompactionStartHooks
): void {
  startForkBoundaryCompactionService(reader, hooks)
  if (installed) {
    return
  }
  installed = true
  const watched = new Set<number>()
  ipcMain.on(FORK_BOUNDARY_COMPACTION_CHANNELS.typed, (event, ids: unknown) => {
    const sender = event.sender
    const sourceId = sender.id
    setForkBoundaryCompactionTyped(sourceId, ids)
    if (watched.has(sourceId)) {
      return
    }
    watched.add(sourceId)
    // A reloaded renderer reports again and replaces the list. A closed window never does, and
    // with no window left nobody knows what the message boxes hold, so the sweep stands still.
    sender.once('destroyed', () => {
      watched.delete(sourceId)
      clearForkBoundaryCompactionTyped(sourceId)
    })
  })
}
