// SLRM-2103 (FORK.md "Usage ledger and cache-cold cue"): start-up hook and the window's side of
// the ledger. Pushes prompt cache states to the main window when they change, and answers the
// usage report (SLRM-2104, FORK.md "Usage and cost report").
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import { FORK_USAGE_LEDGER_CHANNELS as CHANNELS } from '../../../shared/fork/usage-ledger'
import { getProfileUserDataPath } from '../../orca-profiles/profile-storage-paths'
import { mainProcessState } from '../../startup/main-process-state'
import { forkUsageChatMeta as chatMeta, type UsageLedgerStoreReader } from './usage-ledger-meta'

// src/main/index.ts reads the store adapter from here.
export { forkUsageLedgerStoreReader, type UsageLedgerStoreReader } from './usage-ledger-meta'
import { USAGE_LEDGER_FILE_NAME } from './usage-ledger-file'
import {
  forkUsageLedgerCacheStates,
  forkUsageLedgerClear,
  installForkUsageLedgerService,
  onForkUsageLedgerCacheChanged
} from './usage-ledger-service'
import { ForkUsageReportParams } from '../../../shared/fork/usage-report'
import { defaultUsagePrices } from './usage-report'
import { forkUsageReport } from './usage-report-service'

function mainWindowContents(): Electron.WebContents | null {
  const window = mainProcessState.mainWindow
  return window && !window.isDestroyed() ? window.webContents : null
}

/** Main-process start-up hook: load the ledger, answer the window and save on quit. */
export function installForkUsageLedger(readStore: () => UsageLedgerStoreReader | undefined): void {
  // The data folder is final once the app is ready; until then nothing is counted or answered.
  void app.whenReady().then(() => {
    const flush = installForkUsageLedgerService({
      filePath: join(getProfileUserDataPath(), USAGE_LEDGER_FILE_NAME),
      readSettings: () => readStore()?.getSettings(),
      chatMeta: (sessionId) => {
        const store = readStore()
        return store ? chatMeta(sessionId, store) : undefined
      }
    })
    app.on('will-quit', flush)
  })
  ipcMain.handle(CHANNELS.cacheStates, () => forkUsageLedgerCacheStates())
  // SLRM-2104: the usage report, clear history and the built-in prices.
  ipcMain.handle(CHANNELS.report, (_event, params: unknown) =>
    forkUsageReport(ForkUsageReportParams.parse(params ?? {}))
  )
  ipcMain.handle(CHANNELS.clear, () => forkUsageLedgerClear())
  ipcMain.handle(CHANNELS.defaultPrices, () => defaultUsagePrices())
  onForkUsageLedgerCacheChanged(() => {
    mainWindowContents()?.send(CHANNELS.cacheChanged, forkUsageLedgerCacheStates())
  })
}
