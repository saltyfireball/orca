// window.api.forkUpdateInstallWait: the restart guard's update wait for the update card
// (FORK.md "Restart guard", SLRM-1569).
import { ipcRenderer } from 'electron'
import {
  FORK_UPDATE_INSTALL_WAIT_CHANNELS as CHANNELS,
  type ForkUpdateInstallWait,
  type ForkUpdateInstallWaitApi
} from '../../shared/fork/update-install-wait'

export const forkUpdateInstallWaitApi: ForkUpdateInstallWaitApi = {
  get: () => ipcRenderer.invoke(CHANNELS.get),
  installNow: () => ipcRenderer.invoke(CHANNELS.now),
  stopWaiting: () => ipcRenderer.invoke(CHANNELS.stop),
  onChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, wait: ForkUpdateInstallWait | null) =>
      callback(wait)
    ipcRenderer.on(CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(CHANNELS.changed, listener)
  },
  onReleased: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(CHANNELS.released, listener)
    return () => ipcRenderer.removeListener(CHANNELS.released, listener)
  }
}
