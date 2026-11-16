// Snooze (FORK.md, SLRM-2269): the desktop window's side. Pushes the snoozes to the main window
// whenever they change, and takes its snooze, wake and settle calls. Only the main window may
// change anything here; settle is the one way the cleanup command can start.
import { ipcMain } from 'electron'
import { readForkSnoozeSettings } from '../../../shared/fork/snooze'
import {
  FORK_SNOOZE_CHANNELS as CHANNELS,
  ForkSnoozeRequestSchema,
  ForkSnoozeSettleContextSchema,
  isForkSnoozeUntilInRange
} from '../../../shared/fork/snooze-wire'
import type { ForkSnoozeWakeReason } from '../../../shared/fork/snooze'
import { mainProcessState } from '../../startup/main-process-state'
import { getCanonicalUserDataPath } from '../../persistence/loading-store/user-data-path'
import { forkSnoozeStore } from './snooze-store'
import { settleForkSnooze } from './snooze-settle'

const REASONS: readonly ForkSnoozeWakeReason[] = [
  'time',
  'merged',
  'idle',
  'attention',
  'failed',
  'opened',
  'manual'
]

function mainWindowContents(): Electron.WebContents | null {
  const window = mainProcessState.mainWindow
  return window && !window.isDestroyed() ? window.webContents : null
}

function isReason(value: unknown): value is ForkSnoozeWakeReason {
  return typeof value === 'string' && (REASONS as readonly string[]).includes(value)
}

/** Main-process start-up hook. */
export function installForkSnoozeApp(readSettings: () => unknown): void {
  const store = forkSnoozeStore(getCanonicalUserDataPath())
  const fromMainWindow = (event: Electron.IpcMainInvokeEvent): boolean =>
    event.sender === mainWindowContents()
  ipcMain.handle(CHANNELS.list, () => store.list())
  ipcMain.handle(CHANNELS.snooze, async (event, request: unknown) => {
    const parsed = ForkSnoozeRequestSchema.safeParse(request)
    if (
      !fromMainWindow(event) ||
      !parsed.success ||
      !readForkSnoozeSettings(readSettings()).enabled ||
      !isForkSnoozeUntilInRange(parsed.data.until, Date.now())
    ) {
      return null
    }
    return store.snooze(parsed.data.target, parsed.data.until, parsed.data.label)
  })
  ipcMain.handle(CHANNELS.wake, async (event, id: unknown, reason: unknown) => {
    if (!fromMainWindow(event) || typeof id !== 'string' || !isReason(reason)) {
      return false
    }
    return (await store.take(id)) !== null
  })
  ipcMain.handle(CHANNELS.settle, async (event, id: unknown, reason: unknown, context: unknown) => {
    const parsed = ForkSnoozeSettleContextSchema.safeParse(context ?? {})
    if (!fromMainWindow(event) || typeof id !== 'string' || !isReason(reason) || !parsed.success) {
      return { woke: false, cleanup: 'none' }
    }
    return settleForkSnooze(store, readSettings(), { id, reason, context: parsed.data })
  })
  store.onChanged((entries) => {
    mainWindowContents()?.send(CHANNELS.changed, entries)
  })
}
