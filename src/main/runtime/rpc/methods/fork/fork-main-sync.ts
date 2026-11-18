// Keep main current (SLRM-2384, FORK.md): this host's last pass over its projects, and a pass now.
// Backs `orca main-sync` and any paired client; each host answers for its own projects.
import { defineMethod } from '../../core'
import {
  FORK_MAIN_SYNC_RUN_METHOD,
  FORK_MAIN_SYNC_STATUS_METHOD,
  ForkMainSyncRunParams,
  ForkMainSyncStatusParams
} from '../../../../../shared/fork/main-sync'
import { forkMainSyncStatus, runForkMainSync } from '../../../../fork/main-sync/main-sync-live'

export const FORK_MAIN_SYNC_METHODS = [
  defineMethod({
    name: FORK_MAIN_SYNC_STATUS_METHOD,
    permission: 'workspace',
    params: ForkMainSyncStatusParams,
    handler: async () => forkMainSyncStatus()
  }),
  defineMethod({
    name: FORK_MAIN_SYNC_RUN_METHOD,
    permission: 'workspace',
    params: ForkMainSyncRunParams,
    handler: async (params) => ({ results: await runForkMainSync(params.repo) })
  })
] as const
