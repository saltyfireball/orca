// window.api.forkLostWork: the lost work scan and its actions (FORK.md "Lost work", SLRM-2096).
import { ipcRenderer } from 'electron'
import {
  LOST_WORK_CHANNELS as CHANNELS,
  type ForkLostWorkApi,
  type LostWorkScanProgressEvent
} from '../../shared/fork/lost-work'

export const forkLostWorkApi: ForkLostWorkApi = {
  scan: (args) => ipcRenderer.invoke(CHANNELS.scan, args),
  cancel: (scanId) => ipcRenderer.invoke(CHANNELS.cancel, scanId),
  // SLRM-2175: projects done of total, and each repository's items as it finishes.
  onScanProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: LostWorkScanProgressEvent) =>
      callback(progress)
    ipcRenderer.on(CHANNELS.progress, listener)
    return () => ipcRenderer.removeListener(CHANNELS.progress, listener)
  },
  act: (args) => ipcRenderer.invoke(CHANNELS.act, args)
}
