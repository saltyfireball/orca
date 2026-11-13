// window.api.forkLostWork: the lost work scan and its actions (FORK.md "Lost work", SLRM-2096).
import { ipcRenderer } from 'electron'
import { LOST_WORK_CHANNELS as CHANNELS, type ForkLostWorkApi } from '../../shared/fork/lost-work'

export const forkLostWorkApi: ForkLostWorkApi = {
  scan: (args) => ipcRenderer.invoke(CHANNELS.scan, args),
  cancel: (scanId) => ipcRenderer.invoke(CHANNELS.cancel, scanId),
  act: (args) => ipcRenderer.invoke(CHANNELS.act, args)
}
