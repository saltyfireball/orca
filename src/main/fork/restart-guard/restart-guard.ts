// Electron wiring for the restart guard (FORK.md "Restart guard"): before-quit, the restart and
// update IPC handlers, dock progress and the app menu rows.
import {
  app,
  dialog,
  powerMonitor,
  type BrowserWindow,
  type Event,
  type MessageBoxOptions,
  type MessageBoxReturnValue
} from 'electron'
import { rebuildAppMenu } from '../../menu/register-app-menu'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { mainProcessState } from '../../startup/main-process-state'
import { isProcessQuitRequested } from '../../startup/process-quit-request'
import { quitTeardownStartGate } from '../../startup/quit/quit-teardown-start-gate'
import { getUpdateStatus, isQuittingForUpdate, quitAndInstall } from '../../updater/updater-service'
import { translateMain } from '../../i18n/main-i18n'
import type { ForkRestartHeld } from '../../../shared/fork/restart-guard-held'
import { listBusyChats, type BusyChat } from './busy-chats'
import { askBeforeRestart, askWhileWaiting, waitingLabel } from './restart-guard-dialog'
import { setForkRestartGuardHooks } from './restart-guard-hooks'
import {
  RestartGuard,
  type RestartGuardKind,
  type RestartGuardProgress
} from './restart-guard-machine'

const MENU_REFRESH_MS = 30_000

let systemShutdown = false
let guard: RestartGuard | null = null
let menuKey = ''

function liveMainWindow(): BrowserWindow | null {
  const window = mainProcessState.mainWindow
  return window && !window.isDestroyed() ? window : null
}

function showMessageBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue> {
  const window = liveMainWindow()
  // A sheet on a hidden window never shows, which would leave the quit held forever.
  return window?.isVisible()
    ? dialog.showMessageBox(window, options)
    : dialog.showMessageBox(options)
}

function readBusyChats(): BusyChat[] {
  const host = getStructuredAgentSessionHost()
  if (!host) {
    return []
  }
  return listBusyChats(host.loadedSessionIds().map((id) => host.readStatusSummary(id)))
}

function markSystemShutdown(): void {
  systemShutdown = true
}

function showProgress(progress: RestartGuardProgress | null): void {
  const window = liveMainWindow()
  if (window) {
    window.setProgressBar(
      progress ? (progress.total - progress.remaining.length) / Math.max(progress.total, 1) : -1
    )
  }
  refreshMenu()
}

function menuItems(): Electron.MenuItemConstructorOptions[] {
  const current = getGuard()
  const progress = current.getProgress()
  if (progress) {
    return [{ label: `${waitingLabel(progress)}...`, click: () => void current.askAboutWaiting() }]
  }
  if (getUpdateStatus().state !== 'downloaded') {
    return []
  }
  return [
    {
      label: translateMain(
        'fork.restartGuard.menu.updateWhenIdle',
        'Update Ready - Restart When Idle'
      ),
      click: () => current.whenIdle('update', quitAndInstall)
    }
  ]
}

function refreshMenu(): void {
  const progress = guard?.getProgress()
  const key = progress
    ? `wait:${progress.total}:${progress.remaining.length}`
    : `update:${getUpdateStatus().state}`
  if (key !== menuKey) {
    menuKey = key
    rebuildAppMenu()
  }
}

function getGuard(): RestartGuard {
  guard ??= new RestartGuard({
    readBusyChats,
    askBeforeRestart: (kind, chats) => askBeforeRestart(showMessageBox, kind, chats),
    askWhileWaiting: (progress) => askWhileWaiting(showMessageBox, progress),
    quitApp: () => app.quit(),
    schedule: (run, ms) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    },
    onProgress: showProgress,
    now: () => Date.now(),
    onProceedError: (error) => console.error('[restart-guard] deferred restart failed', error)
  })
  return guard
}

/** Call once, before other before-quit listeners are added, so a held quit tears nothing down. */
export function installForkRestartGuard(): void {
  setForkRestartGuardHooks({ menuItems, guardRestart, guardUpdateInstall })
  app.prependListener('before-quit', (event: Event) => {
    const verdict = getGuard().onBeforeQuit({
      defaultPrevented: event.defaultPrevented,
      systemShutdown,
      committedElsewhere:
        mainProcessState.isServeMode ||
        isProcessQuitRequested() ||
        isQuittingForUpdate() ||
        quitTeardownStartGate.hasStarted()
    })
    if (verdict === 'hold') {
      event.preventDefault()
      // Window close handlers read this to tell a quit from a close.
      mainProcessState.isQuitting = false
    }
  })
  if (process.platform === 'win32') {
    app.on('browser-window-created', (_event, window) => {
      window.on('query-session-end', markSystemShutdown)
      window.on('session-end', markSystemShutdown)
    })
  }
  void app.whenReady().then(() => {
    // macOS logout and shutdown arrive as a native quit; this fires first and lets it through.
    powerMonitor.on('shutdown', markSystemShutdown)
    setInterval(refreshMenu, MENU_REFRESH_MS).unref()
  })
}

async function guardRestart(
  kind: RestartGuardKind,
  proceed: () => Promise<void>
): Promise<void | ForkRestartHeld> {
  const result = await getGuard().request(kind, proceed)
  if (result === 'proceed') {
    return proceed()
  }
  return { forkRestartHeld: result }
}

async function guardUpdateInstall(install: () => void): Promise<void> {
  const result = await getGuard().request('update', install)
  if (result === 'proceed') {
    install()
    return
  }
  liveMainWindow()?.webContents.send('updater:quitAndInstallAborted')
}
