// SLRM-2103 (FORK.md "Usage ledger and cache-cold cue"): start-up hook and the window's side of
// the ledger. Pushes prompt cache states to the main window when they change, and answers the
// usage report (SLRM-2104, FORK.md "Usage and cost report").
import { join, basename } from 'node:path'
import { app, ipcMain } from 'electron'
import { splitWorktreeId } from '../../../shared/worktree/id'
import {
  FORK_USAGE_LEDGER_CHANNELS as CHANNELS,
  type ForkUsageLedgerSettings
} from '../../../shared/fork/usage-ledger'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { getProfileUserDataPath } from '../../orca-profiles/profile-storage-paths'
import type { Store } from '../../persistence/loading-store/store'
import { mainProcessState } from '../../startup/main-process-state'
import { forkAgentQueueWorkerParent } from '../agent-queue/agent-queue-service'
import type { UsageChatMeta } from './usage-ledger'
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

export type UsageLedgerStoreReader = {
  getSettings: () => ForkUsageLedgerSettings | undefined
  workspaceName: (workspaceId: string) => string | undefined
}

/** The two things the ledger reads from the app's store, or undefined before it loads. */
export function forkUsageLedgerStoreReader(
  store: Pick<Store, 'getSettings' | 'getWorktreeMeta'> | null | undefined
): UsageLedgerStoreReader | undefined {
  return store
    ? {
        getSettings: () => store.getSettings(),
        workspaceName: (workspaceId) => store.getWorktreeMeta(workspaceId)?.displayName
      }
    : undefined
}

function mainWindowContents(): Electron.WebContents | null {
  const window = mainProcessState.mainWindow
  return window && !window.isDestroyed() ? window.webContents : null
}

const TITLE_CHARS = 80

function chatMeta(sessionId: string, store: UsageLedgerStoreReader): UsageChatMeta | undefined {
  const summary = getStructuredAgentSessionHost()?.readStatusSummary(sessionId)
  const parentSessionId = forkAgentQueueWorkerParent(sessionId)
  if (!summary) {
    return parentSessionId ? { parentSessionId } : undefined
  }
  const text = (summary.conversationName?.trim() || summary.latestPrompt || '')
    .replace(/\s+/g, ' ')
    .trim()
  const title = text.length > TITLE_CHARS ? `${text.slice(0, TITLE_CHARS - 3)}...` : text
  const workspaceId = summary.workspaceId || undefined
  const path = workspaceId ? splitWorktreeId(workspaceId)?.worktreePath : undefined
  const workspaceName =
    (workspaceId ? store.workspaceName(workspaceId)?.trim() : undefined) ||
    (path ? basename(path) : undefined)
  return {
    agent: summary.agent,
    ...(title ? { title } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(workspaceName ? { workspaceName } : {}),
    ...(parentSessionId ? { parentSessionId } : {})
  }
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
