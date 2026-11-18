// window.api.forkClashes: files parallel worktree branches share, for the sidebar chip (FORK.md
// "Branch clashes", SLRM-2394).
import { ipcRenderer } from 'electron'
import type { ForkClashResult } from '../../shared/fork/branch-clashes'
import {
  FORK_CLASHES_CHANNELS as CHANNELS,
  type ForkClashesApi
} from '../../shared/fork/branch-clashes-wire'

export const forkClashesApi: ForkClashesApi = {
  get: () => ipcRenderer.invoke(CHANNELS.get),
  refresh: () => ipcRenderer.invoke(CHANNELS.refresh),
  onChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, result: ForkClashResult | null) =>
      callback(result)
    ipcRenderer.on(CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(CHANNELS.changed, listener)
  }
}
