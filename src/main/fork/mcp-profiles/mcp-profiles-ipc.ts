// FORK.md "MCP profiles": the main-process start-up hook and the window's IPC.
import { app, ipcMain } from 'electron'
import { FORK_MCP_CHANNELS as CHANNELS } from '../../../shared/fork/mcp-profiles'
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'
import { mainProcessState } from '../../startup/main-process-state'
import { forkMcpChat, forkMcpList, forkMcpSetChat } from './mcp-profiles-service'
import { installForkProfilesOnHost } from './mcp-profiles-host'

function mainWindowContents(): Electron.WebContents | null {
  const window = mainProcessState.mainWindow
  return window && !window.isDestroyed() ? window.webContents : null
}

/** Settings are read on every launch, so a changed profile applies at the next chat start. */
export function installForkMcpProfilesApp(
  readSettings: () => ForkGlobalSettings | undefined
): void {
  // BAD-741/BAD-800: agent and MCP profiles, the same install orcad runs (FORK.md "MCP profiles").
  const profiles = installForkProfilesOnHost({
    readSettings,
    userDataPath: app.getPath('userData')
  })
  app.on('will-quit', () => {
    void profiles.shutdown()
  })
  ipcMain.handle(CHANNELS.list, (_event, folder: unknown) =>
    forkMcpList(typeof folder === 'string' && folder !== '' ? folder : undefined)
  )
  ipcMain.handle(CHANNELS.chat, (_event, sessionId: unknown) =>
    typeof sessionId === 'string' ? forkMcpChat(sessionId) : null
  )
  ipcMain.handle(CHANNELS.setChat, (event, sessionId: unknown, profile: unknown) => {
    if (event.sender !== mainWindowContents() || typeof sessionId !== 'string') {
      return null
    }
    return forkMcpSetChat(sessionId, typeof profile === 'string' ? profile : null)
  })
}
