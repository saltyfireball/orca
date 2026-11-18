// window.api.forkAgentGuards: guarded agents for the status line, and Resume
// (FORK.md "Agent guards", SLRM-2385).
import { ipcRenderer } from 'electron'
import type { AgentGuardEntry } from '../../shared/fork/agent-guards'
import {
  FORK_AGENT_GUARDS_CHANNELS as CHANNELS,
  type ForkAgentGuardsApi
} from '../../shared/fork/agent-guards-wire'

export const forkAgentGuardsApi: ForkAgentGuardsApi = {
  list: () => ipcRenderer.invoke(CHANNELS.list),
  resume: (id) => ipcRenderer.invoke(CHANNELS.resume, id),
  onChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, entries: AgentGuardEntry[]) =>
      callback(entries)
    ipcRenderer.on(CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(CHANNELS.changed, listener)
  }
}
