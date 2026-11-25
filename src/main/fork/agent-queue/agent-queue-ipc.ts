// SLRM-2098 (FORK.md "Agent launch queue"): the window's side of the queue. Pushes the queue to
// the main window whenever it changes and answers the queued banner's Start now and Cancel.
import { ipcMain } from 'electron'
import { FORK_AGENT_QUEUE_CHANNELS as CHANNELS } from '../../../shared/fork/agent-queue'
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'
import { mainProcessState } from '../../startup/main-process-state'
import {
  forkAgentQueueCancel,
  forkAgentQueueSnapshot,
  forkAgentQueueStartNow,
  installForkAgentQueue,
  onForkAgentQueueChanged
} from './agent-queue-service'
import { forkAgentQueueRuntimeTerminals } from './agent-queue-runtime'

function mainWindowContents(): Electron.WebContents | null {
  const window = mainProcessState.mainWindow
  return window && !window.isDestroyed() ? window.webContents : null
}

/**
 * Main-process start-up hook: the settings reader plus the window IPC. Settings are read on every
 * launch and on the queue's 2 s check while anything waits, so a raised limit or a switch-off
 * starts waiting launches within one check without a change subscription.
 */
export function installForkAgentQueueApp(readSettings: () => ForkGlobalSettings | undefined): void {
  installForkAgentQueue(
    readSettings,
    forkAgentQueueRuntimeTerminals(() => mainProcessState.core.runtime)
  )
  const fromMainWindow = (event: Electron.IpcMainInvokeEvent): boolean =>
    event.sender === mainWindowContents()
  ipcMain.handle(CHANNELS.get, () => forkAgentQueueSnapshot())
  ipcMain.handle(CHANNELS.start, (event, id: unknown) =>
    fromMainWindow(event) && typeof id === 'string' ? forkAgentQueueStartNow(id) : false
  )
  ipcMain.handle(CHANNELS.cancel, (event, id: unknown) =>
    fromMainWindow(event) && typeof id === 'string' ? forkAgentQueueCancel(id) : false
  )
  onForkAgentQueueChanged(() => {
    mainWindowContents()?.send(CHANNELS.changed, forkAgentQueueSnapshot())
  })
}
