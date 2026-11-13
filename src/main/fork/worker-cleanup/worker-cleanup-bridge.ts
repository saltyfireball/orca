// Worker cleanup (FORK.md): the desktop side. Sends each sweep's notice and the held list to every
// window, and answers Undo and a window's first read of the held list. Kept apart from the
// service so the runtime wiring never imports electron.
import { BrowserWindow, ipcMain } from 'electron'
import { FORK_WORKER_CLEANUP_CHANNELS } from '../../../shared/fork/worker-cleanup'
import { readWorkerCleanupHeld, setWorkerCleanupPublisher } from './worker-cleanup-notices'
import { undoForkWorkerCleanup } from './worker-cleanup-undo'

let installed = false

function sendToWindows(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}

export function installForkWorkerCleanupBridge(): void {
  if (installed) {
    return
  }
  installed = true
  setWorkerCleanupPublisher({
    notice: (notice) => sendToWindows(FORK_WORKER_CLEANUP_CHANNELS.notice, notice),
    held: (held) => sendToWindows(FORK_WORKER_CLEANUP_CHANNELS.held, held)
  })
  ipcMain.handle(FORK_WORKER_CLEANUP_CHANNELS.readHeld, () => readWorkerCleanupHeld())
  ipcMain.handle(FORK_WORKER_CLEANUP_CHANNELS.undo, (_event, noticeId: unknown) =>
    typeof noticeId === 'string' && noticeId.length <= 64
      ? undoForkWorkerCleanup(noticeId)
      : { reopenChats: [] }
  )
}
