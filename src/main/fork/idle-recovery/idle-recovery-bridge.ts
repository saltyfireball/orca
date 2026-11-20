// Idle recovery (FORK.md), item E2: the desktop side of `window.api.forkIdleRecovery`.
// Contract: answer the window's inbox, answer, pause and status calls from the service, refuse
// a malformed request without calling it, and tell every window when the inbox changes. Kept
// apart from the service so the service never imports electron.
import { BrowserWindow, ipcMain } from 'electron'
import {
  FORK_IDLE_RECOVERY_CHANNELS as CHANNELS,
  ForkIdleRecoveryAnswerParams,
  ForkIdleRecoveryPauseParams
} from '../../../shared/fork/idle-recovery-wire'
import { ForkBotAsksReportParams } from '../../../shared/fork/inbox-bot-asks'
import { reportForkBotAsks } from '../bot-asks/bot-asks-notify'
import { mainProcessState } from '../../startup/main-process-state'
import {
  answerIdleRecoveryChat,
  listIdleRecoveryInbox,
  onIdleRecoveryChanged,
  readIdleRecoveryStatus,
  setIdleRecoveryPaused
} from './idle-recovery-service'
import { listForkPrBabysit } from '../pr-babysit/pr-babysit-hooks'
import { onForkInboxSourceChanged } from './idle-recovery-sources'

let installed = false

/** Hook in `src/main/index.ts`. Idempotent. */
export function installForkIdleRecoveryBridge(): void {
  if (installed) {
    return
  }
  installed = true
  ipcMain.handle(CHANNELS.inbox, () => listIdleRecoveryInbox())
  ipcMain.handle(CHANNELS.status, () => readIdleRecoveryStatus())
  ipcMain.handle(CHANNELS.babysit, () => listForkPrBabysit())
  // SLRM-2453: bot asks a window reads; new ones go to the notify targets once.
  ipcMain.handle(CHANNELS.botAsks, (_event, request: unknown) =>
    reportForkBotAsks(ForkBotAsksReportParams.parse(request), {
      settings: () => mainProcessState.store?.getSettings(),
      runtime: () => mainProcessState.runtime
    })
  )
  ipcMain.handle(CHANNELS.answer, (_event, request: unknown) =>
    answerIdleRecoveryChat(ForkIdleRecoveryAnswerParams.parse(request))
  )
  ipcMain.handle(CHANNELS.pause, (_event, request: unknown) =>
    setIdleRecoveryPaused(ForkIdleRecoveryPauseParams.parse(request))
  )
  const tellWindows = (): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(CHANNELS.changed)
      }
    }
  }
  onIdleRecoveryChanged(tellWindows)
  // Other features' inbox rows (the PR babysitter, SLRM-2386) and its status lines.
  onForkInboxSourceChanged(tellWindows)
}
