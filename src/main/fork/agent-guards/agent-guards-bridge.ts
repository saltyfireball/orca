// Agent guards (FORK.md, SLRM-2385): the guarded agents for the renderer's status line, and its
// Resume. Kept apart from the service so the headless server never imports electron.
import { BrowserWindow, ipcMain } from 'electron'
import type { AgentGuardEntry } from '../../../shared/fork/agent-guards'
import { FORK_AGENT_GUARDS_CHANNELS } from '../../../shared/fork/agent-guards-wire'
import {
  forkAgentGuardEntries,
  forkAgentGuardResume,
  onForkAgentGuardsChanged
} from './agent-guards-service'

let installed = false

function broadcast(entries: AgentGuardEntry[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(FORK_AGENT_GUARDS_CHANNELS.changed, entries)
    }
  }
}

export function installForkAgentGuardsBridge(): void {
  if (installed) {
    return
  }
  installed = true
  onForkAgentGuardsChanged(broadcast)
  ipcMain.handle(FORK_AGENT_GUARDS_CHANNELS.list, () => forkAgentGuardEntries())
  ipcMain.handle(FORK_AGENT_GUARDS_CHANNELS.resume, (_event, id: unknown) => {
    if (typeof id !== 'string' || id.length === 0 || id.length > 600) {
      throw new Error('Name a guarded agent.')
    }
    return forkAgentGuardResume(id)
  })
}
