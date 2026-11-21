// Branch clashes (FORK.md, SLRM-2394): the desktop's side. Checks every few minutes (the setting)
// while the warning is on, pushes each result to the main window, and answers its get and
// refresh calls. Nothing runs while the warning is off.
import { ipcMain } from 'electron'
import { readForkBranchClashConfig } from '../../../shared/fork/branch-clashes'
import { FORK_CLASHES_CHANNELS as CHANNELS } from '../../../shared/fork/branch-clashes-wire'
import { mainProcessState } from '../../startup/main-process-state'
import {
  clearForkClashes,
  forkClashesLatest,
  forkClashFleetDeps,
  onForkClashesChanged,
  runForkClashCheck
} from './branch-clashes-state'

/** The first check waits for start-up work to settle. */
const FIRST_CHECK_DELAY_MS = 30_000
/** How often the timer looks at the setting; a check runs only once its interval has passed. */
const TICK_MS = 30_000

function mainWindowContents(): Electron.WebContents | null {
  const window = mainProcessState.mainWindow
  return window && !window.isDestroyed() ? window.webContents : null
}

async function check(): Promise<void> {
  const runtime = mainProcessState.core.runtime
  if (!runtime) {
    return
  }
  await runForkClashCheck(forkClashFleetDeps(runtime)).catch((error: unknown) => {
    console.warn('[fork-branch-clashes] check failed:', error)
  })
}

let installed = false

/** Main-process start-up hook. */
export function installForkBranchClashesApp(readSettings: () => unknown): void {
  if (installed || process.env.VITEST) {
    return
  }
  installed = true
  const fromMainWindow = (event: Electron.IpcMainInvokeEvent): boolean =>
    event.sender === mainWindowContents()
  ipcMain.handle(CHANNELS.get, (event) => (fromMainWindow(event) ? forkClashesLatest() : null))
  ipcMain.handle(CHANNELS.refresh, async (event) => {
    if (!fromMainWindow(event) || !readForkBranchClashConfig(readSettings()).enabled) {
      return forkClashesLatest()
    }
    await check()
    return forkClashesLatest()
  })
  onForkClashesChanged((result) => mainWindowContents()?.send(CHANNELS.changed, result))
  const startedAt = Date.now()
  let lastCheckAt = 0
  const tick = (): void => {
    const config = readForkBranchClashConfig(readSettings())
    if (!config.enabled) {
      clearForkClashes()
      return
    }
    const now = Date.now()
    const latest = forkClashesLatest()
    const last = Math.max(lastCheckAt, latest?.scannedAt ?? 0)
    if (now - startedAt < FIRST_CHECK_DELAY_MS || now - last < config.intervalMinutes * 60_000) {
      return
    }
    lastCheckAt = now
    void check()
  }
  setInterval(tick, TICK_MS).unref()
}
