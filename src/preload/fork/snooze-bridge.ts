// window.api.forkSnooze: snoozed workspaces and chats for the sidebar (FORK.md "Snooze",
// SLRM-2269).
import { ipcRenderer } from 'electron'
import type { ForkSnoozeEntry } from '../../shared/fork/snooze'
import { FORK_SNOOZE_CHANNELS as CHANNELS, type ForkSnoozeApi } from '../../shared/fork/snooze-wire'

export const forkSnoozeApi: ForkSnoozeApi = {
  list: () => ipcRenderer.invoke(CHANNELS.list),
  snooze: (request) => ipcRenderer.invoke(CHANNELS.snooze, request),
  wake: (id, reason) => ipcRenderer.invoke(CHANNELS.wake, id, reason),
  settle: (id, reason, context) => ipcRenderer.invoke(CHANNELS.settle, id, reason, context),
  onChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, entries: ForkSnoozeEntry[]) =>
      callback(entries)
    ipcRenderer.on(CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(CHANNELS.changed, listener)
  }
}
