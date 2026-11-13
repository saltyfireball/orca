// Electron wiring for the restart guard (FORK.md "Restart guard"): before-quit, the restart and
// update IPC handlers, dock progress and the app menu rows.
import {
  app,
  dialog,
  ipcMain,
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
import { safelyRevealWindow } from '../../window/focus-existing-window'
import { isBackgroundLaunch } from '../../window/foreground-activation-policy'
import type { ForkRestartHeld } from '../../../shared/fork/restart-guard-held'
import { FORK_UPDATE_INSTALL_WAIT_CHANNELS } from '../../../shared/fork/update-install-wait'
import { chatSurviveWillSurvive } from '../chat-survive/chat-survive-detach'
import { listBusyChats, type BusyChat } from './busy-chats'
import { askBeforeRestart, askWhileWaiting, waitingLabel } from './restart-guard-dialog'
import { setForkRestartGuardHooks } from './restart-guard-hooks'
import { createSystemShutdownLatch } from './system-shutdown-latch'
import {
  RestartGuard,
  type RestartGuardKind,
  type RestartGuardProgress
} from './restart-guard-machine'
import { createUpdateInstallWait } from './update-install-wait'

const schedule = (run: () => void, ms: number): (() => void) => {
  const timer = setTimeout(run, ms)
  return () => clearTimeout(timer)
}
const systemShutdown = createSystemShutdownLatch(schedule)
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

function logError(error: unknown): void {
  console.error('[restart-guard] failing open', error)
}

const updateWait = createUpdateInstallWait({
  send: (channel, ...args) => liveMainWindow()?.webContents.send(channel, ...args),
  getGuard: () => getGuard(),
  onError: logError
})

/** Reveal the window the sheet sits on, as Quit Completely does; a hidden one never shows it. */
function bringForward(): void {
  const window = liveMainWindow()
  if (window) {
    safelyRevealWindow(window)
  }
  // Background (agent and test) launches must never take focus.
  if (process.platform === 'darwin' && !isBackgroundLaunch()) {
    app.focus({ steal: true })
  }
}

function readBusyChats(): BusyChat[] {
  const host = getStructuredAgentSessionHost()
  if (!host) {
    return []
  }
  return listBusyChats(
    host.loadedSessionIds().map((id) => host.readStatusSummary(id)),
    chatSurviveWillSurvive
  )
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
  try {
    return buildMenuItems()
  } catch (error) {
    logError(error)
    return []
  }
}

function buildMenuItems(): Electron.MenuItemConstructorOptions[] {
  const current = getGuard()
  const progress = current.getProgress()
  if (progress) {
    return [{ label: `${waitingLabel(progress)}...`, click: () => void current.askAboutWaiting() }]
  }
  if (getUpdateStatus().state !== 'downloaded' || isQuittingForUpdate()) {
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
  try {
    const progress = guard?.getProgress()
    const key = progress
      ? `wait:${progress.kind}:${progress.total}:${progress.remaining.length}`
      : `update:${getUpdateStatus().state}:${isQuittingForUpdate()}`
    if (key !== menuKey) {
      menuKey = key
      rebuildAppMenu()
    }
  } catch (error) {
    logError(error)
  }
}

function getGuard(): RestartGuard {
  guard ??= new RestartGuard({
    readBusyChats,
    askBeforeRestart: (kind, chats) => askBeforeRestart(showMessageBox, kind, chats),
    askWhileWaiting: (progress) => askWhileWaiting(showMessageBox, progress),
    bringForward,
    quitApp: () => app.quit(),
    schedule,
    onProgress: (progress) => {
      showProgress(progress)
      updateWait.progressChanged(progress)
    },
    onWaitEnded: updateWait.waitEnded,
    now: () => Date.now(),
    onError: logError
  })
  return guard
}

/** Call once, before other before-quit listeners are added, so a held quit tears nothing down. */
export function installForkRestartGuard(): void {
  setForkRestartGuardHooks({
    menuItems,
    guardRestart,
    guardUpdateInstall: updateWait.guardInstall,
    onUpdaterStatus: refreshMenu
  })
  registerUpdateInstallWaitIpc()
  app.prependListener('before-quit', (event: Event) => {
    try {
      const verdict = getGuard().onBeforeQuit({
        defaultPrevented: event.defaultPrevented,
        systemShutdown: systemShutdown.isSet(),
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
    } catch (error) {
      logError(error)
    }
  })
  if (process.platform === 'win32') {
    app.on('browser-window-created', (_event, window) => {
      window.on('query-session-end', systemShutdown.mark)
      window.on('session-end', systemShutdown.mark)
    })
  }
  void app.whenReady().then(() => {
    // macOS logout and shutdown arrive as a native quit; this fires first and lets it through.
    powerMonitor.on('shutdown', systemShutdown.mark)
    powerMonitor.on('resume', systemShutdown.reset)
    // Updater status and wait progress push refreshMenu; focus catches any change made without
    // a status push (such as a cancelled install), before the menu is in front of anyone.
    app.on('browser-window-focus', refreshMenu)
    app.on('did-become-active', refreshMenu)
  })
}

async function guardRestart(
  kind: RestartGuardKind,
  proceed: () => Promise<void>,
  deferred: () => Promise<void>
): Promise<void | ForkRestartHeld> {
  let result: Awaited<ReturnType<RestartGuard['request']>>
  try {
    result = await getGuard().request(kind, deferred)
  } catch (error) {
    logError(error)
    result = 'proceed'
  }
  if (result === 'proceed') {
    return proceed()
  }
  return { forkRestartHeld: result }
}

/** The update card's wait view and its Restart Now and Stop Waiting buttons (SLRM-1569). */
function registerUpdateInstallWaitIpc(): void {
  const fromMainWindow = (event: Electron.IpcMainInvokeEvent): boolean =>
    event.sender === liveMainWindow()?.webContents
  ipcMain.handle(FORK_UPDATE_INSTALL_WAIT_CHANNELS.get, (event) =>
    fromMainWindow(event) ? updateWait.current() : null
  )
  ipcMain.handle(FORK_UPDATE_INSTALL_WAIT_CHANNELS.now, (event) => {
    if (fromMainWindow(event)) {
      updateWait.installNow()
    }
  })
  ipcMain.handle(FORK_UPDATE_INSTALL_WAIT_CHANNELS.stop, (event) => {
    if (fromMainWindow(event)) {
      updateWait.stopWaiting()
    }
  })
}
