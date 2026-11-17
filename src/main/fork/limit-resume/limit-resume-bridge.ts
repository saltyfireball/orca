// Limit resume (FORK.md, SLRM-2309): the parked chats and terminal agents for the renderer's
// "resumes at" labels. Kept apart from the service so the headless server never imports electron.
import { BrowserWindow, ipcMain } from 'electron'
import type { LimitResumeEntry } from '../../../shared/fork/limit-resume'
import { FORK_LIMIT_RESUME_CHANNELS } from '../../../shared/fork/limit-resume-wire'
import { forkLimitResumeEntries, onForkLimitResumeChanged } from './limit-resume-service'

let installed = false

function broadcast(entries: LimitResumeEntry[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(FORK_LIMIT_RESUME_CHANNELS.changed, entries)
    }
  }
}

export function installForkLimitResumeBridge(): void {
  if (installed) {
    return
  }
  installed = true
  onForkLimitResumeChanged(broadcast)
  ipcMain.handle(FORK_LIMIT_RESUME_CHANNELS.list, () => forkLimitResumeEntries())
}
