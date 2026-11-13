// FORK.md "MCP profiles": the main-process start-up hook and the window's IPC.
import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { FORK_MCP_CHANNELS as CHANNELS } from '../../../shared/fork/mcp-profiles'
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'
import { mainProcessState } from '../../startup/main-process-state'
import {
  forkMcpChat,
  forkMcpList,
  forkMcpSetChat,
  installForkMcpProfiles,
  shutdownForkMcpProfiles
} from './mcp-profiles-service'

function mainWindowContents(): Electron.WebContents | null {
  const window = mainProcessState.mainWindow
  return window && !window.isDestroyed() ? window.webContents : null
}

/** Settings are read on every launch, so a changed profile applies at the next chat start. */
export function installForkMcpProfilesApp(
  readSettings: () => ForkGlobalSettings | undefined
): void {
  const dataFolder = join(app.getPath('userData'), 'fork-mcp-profiles')
  void installForkMcpProfiles({ readSettings, dataFolder }).catch((error: unknown) =>
    console.warn('[fork-mcp-profiles] start-up failed', String(error))
  )
  app.on('will-quit', () => {
    void shutdownForkMcpProfiles()
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
