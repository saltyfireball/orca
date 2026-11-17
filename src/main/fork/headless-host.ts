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

export type ForkHeadlessHostStore = {
  getSettings: () => NonNullable<ReturnType<BoundaryCompactionSettingsReader>>
  onSettingsChanged: (listener: (updates: Partial<ForkGlobalSettings>) => void) => unknown
}

/**
 * - `orca settings` writes this host's own settings store (FORK.md "Settings from the CLI").
 * - Boundary compaction sweeps the chats whose agent runs here; off unless its mode is on.
 * - The server heartbeat calls its outside address, when one is set (FORK.md "Server health").
 * Returns what to run at shutdown.
 */
export function installForkHeadlessHost(store: ForkHeadlessHostStore): () => void {
  forkMarkHeadlessSettingsHost()
  startForkBoundaryCompactionService(() => store.getSettings(), {
    store: () => store,
    windowless: () => true
  })
  startForkServerHeartbeat(() => store.getSettings())
  return () => {
    stopForkBoundaryCompactionService()
    stopForkServerHeartbeat()
  }
}
