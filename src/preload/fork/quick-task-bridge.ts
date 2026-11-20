// window.api.forkQuickTask: the quick task box's calls to main (FORK.md "Quick task", SLRM-2428).
// Main answers them only from the box window.
import { ipcRenderer } from 'electron'
import {
  FORK_QUICK_TASK_CHANNELS as CHANNELS,
  type ForkQuickTaskApi
} from '../../shared/fork/quick-task'

export const forkQuickTaskApi: ForkQuickTaskApi = {
  submit: (text) => ipcRenderer.invoke(CHANNELS.submit, text),
  close: () => ipcRenderer.send(CHANNELS.close),
  openChat: (chatId) => ipcRenderer.invoke(CHANNELS.openChat, chatId),
  onShown: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(CHANNELS.shown, listener)
    return () => {
      ipcRenderer.removeListener(CHANNELS.shown, listener)
    }
  }
}
