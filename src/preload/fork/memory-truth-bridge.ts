// window.api.forkMemory: the memory warning status (FORK.md "Memory truth", SLRM-2099).
import { ipcRenderer } from 'electron'
import {
  FORK_MEMORY_CHANNELS as CHANNELS,
  type ForkMemoryApi,
  type ForkMemoryStatus
} from '../../shared/fork/memory-truth'

export const forkMemoryApi: ForkMemoryApi = {
  getStatus: () => ipcRenderer.invoke(CHANNELS.get),
  onChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: ForkMemoryStatus) =>
      callback(status)
    ipcRenderer.on(CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(CHANNELS.changed, listener)
  }
}
