// window.api.forkAgentQueue: the agent launch queue for the queued banner, tab badge and
// settings (FORK.md "Agent launch queue", SLRM-2098).
import { ipcRenderer } from 'electron'
import {
  FORK_AGENT_QUEUE_CHANNELS as CHANNELS,
  type ForkAgentQueueApi,
  type ForkAgentQueueSnapshot
} from '../../shared/fork/agent-queue'

export const forkAgentQueueApi: ForkAgentQueueApi = {
  get: () => ipcRenderer.invoke(CHANNELS.get),
  start: (id) => ipcRenderer.invoke(CHANNELS.start, id),
  cancel: (id) => ipcRenderer.invoke(CHANNELS.cancel, id),
  onChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: ForkAgentQueueSnapshot) =>
      callback(snapshot)
    ipcRenderer.on(CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(CHANNELS.changed, listener)
  }
}
