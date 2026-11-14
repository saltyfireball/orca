// window.api.forkBoundaryCompaction: the renderer's native chats with text in the message box,
// for boundary compaction (FORK.md "Boundary compaction").
import { ipcRenderer } from 'electron'
import {
  FORK_BOUNDARY_COMPACTION_CHANNELS,
  type ForkBoundaryCompactionApi
} from '../../shared/fork/boundary-compaction'

export const forkBoundaryCompactionApi: ForkBoundaryCompactionApi = {
  setTyped: (sessionIds) => ipcRenderer.send(FORK_BOUNDARY_COMPACTION_CHANNELS.typed, sessionIds)
}
