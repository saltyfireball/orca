// The fork's installs on a host that runs without the desktop app (orcad, behind `orca serve`),
// called once from `src/main/backend/core-runtime-activation.ts` before the RPC server starts.
// Keep electron out of this file.
import type { ForkApfsCloneSettings } from '../../shared/fork/apfs-clone'
import type { ForkGlobalSettings } from '../../shared/fork/fork-global-settings'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { installForkAgentQueue } from './agent-queue/agent-queue-service'
import { installForkApfsCloneSettingsReader } from './apfs-clone/apfs-clone-settings-reader'
import { forkAgentQueueRuntimeTerminals } from './agent-queue/agent-queue-runtime'
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
import {
  installForkCommandGuards,
  type ForkCommandGuardsHostStore
} from './command-guards/command-guards-install'
import {
  installForkProfilesOnHost,
  type ForkProfilesHostSettings
} from './mcp-profiles/mcp-profiles-host'

export type ForkHeadlessHostStore = Omit<ForkCommandGuardsHostStore, 'getSettings'> & {
  getSettings: () => NonNullable<ReturnType<BoundaryCompactionSettingsReader>> &
    ForkProfilesHostSettings &
    ForkApfsCloneSettings
  onSettingsChanged: (listener: (updates: Partial<ForkGlobalSettings>) => void) => unknown
}

/**
 * - The agent launch queue follows this host's own settings, and Pause all holds its chat worker
 *   launches, also the ones a restart replays (BAD-818).
 * - `orca settings` writes this host's own settings store (FORK.md "Settings from the CLI").
 * - Boundary compaction sweeps the chats whose agent runs here; off unless its mode is on.
 * - The server heartbeat calls its outside address, when one is set (FORK.md "Server health").
 * - `::orca-visual` image files and unquoted values follow this host's own setting (SLRM-2349).
 * - The usage ledger counts the Claude chats that run here, for the spend cap (SLRM-2385).
 * - Workspace port blocks follow this host's own settings (SLRM-2383).
 * - Worktrees are snapshotted before removal by this host's own settings (BAD-677).
 * - Workspace files are checkpointed at each agent turn by this host's own settings (BAD-678).
 * - Command guards answer from here on, before a chat can start (BAD-764).
 * - The PR babysitter acts on CI lines of this host's chats (SLRM-2386).
 * - PR nudges send this host's chats their pull requests' new review comments and conflicts (BAD-680).
 * - New worktrees get APFS clones of ignored folders and the cached checkout by this host's own
 *   settings (SLRM-2270, BAD-562); the hooks do nothing off macOS.
 * - Agent and MCP profiles apply to the launches that run here, from this host's own settings and
 *   `<userDataPath>/fork-mcp-profiles` (BAD-800). Resolves once they are loaded, before the RPC
 *   server starts, so no launch arrives ahead of them.
 * Resolves to what to run at shutdown.
 */
export async function installForkHeadlessHost(
  store: ForkHeadlessHostStore,
  userDataPath: string,
  runtime?: OrcaRuntimeService
): Promise<() => Promise<void>> {
  forkMarkHeadlessSettingsHost()
  installForkAgentQueue(
    () => store.getSettings() as ForkGlobalSettings,
    forkAgentQueueRuntimeTerminals(() => runtime)
  )
  installForkCommandGuards(store)
  installForkApfsCloneSettingsReader(() => store.getSettings())
  const profiles = installForkProfilesOnHost({
    readSettings: () => store.getSettings(),
    userDataPath
  })
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
  await profiles.ready
  return async () => {
    installForkApfsCloneSettingsReader(null)
    stopPrBabysit()
    stopPrNudge()
    stopForkBoundaryCompactionService()
    stopForkServerHeartbeat()
    flushLedger?.()
    await profiles.shutdown()
  }
}
