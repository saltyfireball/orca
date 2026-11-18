// SLRM-2385 (FORK.md "Agent guards"): the usage ledger on a host that runs without the desktop app
// (orcad, behind `orca serve`), so the spend cap reads what the chats there spent. Its file is the
// server's own `fork-usage-ledger.json` in its data folder. Keep electron out of this file.
import { join } from 'node:path'
import type { ForkUsageLedgerSettings } from '../../../shared/fork/usage-ledger'
import { USAGE_LEDGER_FILE_NAME } from './usage-ledger-file'
import { forkUsageChatMeta } from './usage-ledger-meta'
import { installForkUsageLedgerService } from './usage-ledger-service'

/** Loads the ledger and starts counting. Returns the shutdown flush. */
export async function installForkUsageLedgerOnServer(
  readSettings: () => ForkUsageLedgerSettings | undefined
): Promise<() => void> {
  const { getProfileUserDataPath } = await import('../../orca-profiles/profile-storage-paths')
  const reader = { getSettings: readSettings, workspaceName: () => undefined }
  return installForkUsageLedgerService({
    filePath: join(getProfileUserDataPath(), USAGE_LEDGER_FILE_NAME),
    readSettings,
    chatMeta: (sessionId) => forkUsageChatMeta(sessionId, reader)
  })
}
