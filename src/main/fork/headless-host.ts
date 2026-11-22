// The fork's installs on a host that runs without the desktop app (orcad, behind `orca serve`),
// called once from `src/main/backend/core-runtime-activation.ts` before the RPC server starts.
// Keep electron out of this file.
import type { ForkGlobalSettings } from '../../shared/fork/fork-global-settings'
import {
  startForkBoundaryCompactionService,
  stopForkBoundaryCompactionService,
  type BoundaryCompactionSettingsReader
} from './boundary-compaction/boundary-compaction-service'
import { forkMarkHeadlessSettingsHost } from './settings-cli/settings-cli-headless'
import {
  startForkServerHeartbeat,
  stopForkServerHeartbeat
} from './server-health/server-health-service'
import { installForkVisualFallbackSettings } from './visual-image/visual-image-settings'
import { installForkUsageLedgerOnServer } from './usage-ledger/usage-ledger-server'
import { installForkWorktreePorts } from './worktree-ports/worktree-ports-service'
import { installForkWorktreeSnapshots } from './worktree-snapshots/worktree-snapshot-service'
import { installForkTurnCheckpoints } from './turn-checkpoints/turn-checkpoint-live'
import { installForkPrBabysit } from './pr-babysit/pr-babysit-hooks'
import { installForkPrNudge } from './pr-nudge/pr-nudge-hooks'

export type ForkHeadlessHostStore = {
  getSettings: () => NonNullable<ReturnType<BoundaryCompactionSettingsReader>>
  onSettingsChanged: (listener: (updates: Partial<ForkGlobalSettings>) => void) => unknown
}

/**
 * - `orca settings` writes this host's own settings store (FORK.md "Settings from the CLI").
 * - Boundary compaction sweeps the chats whose agent runs here; off unless its mode is on.
 * - The server heartbeat calls its outside address, when one is set (FORK.md "Server health").
 * - `::orca-visual` image files and unquoted values follow this host's own setting (SLRM-2349).
 * - The usage ledger counts the Claude chats that run here, for the spend cap (SLRM-2385).
 * - Workspace port blocks follow this host's own settings (SLRM-2383).
 * - Worktrees are snapshotted before removal by this host's own settings (BAD-677).
 * - Workspace files are checkpointed at each agent turn by this host's own settings (BAD-678).
 * - The PR babysitter acts on CI lines of this host's chats (SLRM-2386).
 * - PR nudges send this host's chats their pull requests' new review comments and conflicts (BAD-680).
 * Returns what to run at shutdown.
 */
export function installForkHeadlessHost(store: ForkHeadlessHostStore): () => void {
  forkMarkHeadlessSettingsHost()
  startForkBoundaryCompactionService(() => store.getSettings(), {
    store: () => store,
    windowless: () => true
  })
  startForkServerHeartbeat(() => store.getSettings())
  installForkVisualFallbackSettings(store)
  let flushLedger: (() => void) | null = null
  // Runtime tests reach this install too; the ledger (its file and prune timer) stays off there.
  if (!process.env.VITEST) {
    void installForkUsageLedgerOnServer(() => store.getSettings())
      .then((flush) => {
        flushLedger = flush
      })
      .catch((error: unknown) => console.warn('[fork-usage-ledger] could not start', error))
  }
  installForkWorktreePorts(store)
  installForkWorktreeSnapshots(store)
  installForkTurnCheckpoints(store)
  const stopPrBabysit = installForkPrBabysit(store)
  const stopPrNudge = installForkPrNudge(store)
  return () => {
    stopPrBabysit()
    stopPrNudge()
    stopForkBoundaryCompactionService()
    stopForkServerHeartbeat()
    flushLedger?.()
  }
}
