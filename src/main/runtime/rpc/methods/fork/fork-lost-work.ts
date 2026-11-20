// SLRM-2096 (FORK.md "Lost work"): `orca lost-work` reads the same read-only scan as the desktop's
// Lost work dialog. Only the desktop app installs the scan host, so a host without it says so.
import { defineMethod, type RpcContext } from '../../core'
import { FORK_WORKER_ARCHIVE_METHODS } from './fork-worker-methods'
import {
  ForkLostWorkScanParams,
  resolveLostWorkSettings,
  type LostWorkScanResult
} from '../../../../../shared/fork/lost-work'
import { annotateLostWorkUse } from '../../../../../shared/fork/lost-work-use'
import { sleeperSourcesFromPs } from '../../../../../shared/fork/sleepers-ps-sources'
import { lostWorkUseFromPs } from '../../../../fork/lost-work/lost-work-use-ps'
import { forkSleeperChatFacts } from '../../../../fork/sleepers/sleepers-host'
import {
  forkLostWorkStore,
  runForkLostWorkScan
} from '../../../../fork/lost-work/lost-work-service'

/**
 * SLRM-2230: marks rows whose workspace has agents, chats or terminals, from the runtime's own
 * rows. A host that cannot list them returns the scan as it is.
 */
async function withUse(result: LostWorkScanResult, ctx: RpcContext): Promise<LostWorkScanResult> {
  try {
    const { worktrees } = await ctx.runtime.getWorktreePs()
    const uses = lostWorkUseFromPs(
      worktrees,
      sleeperSourcesFromPs(worktrees, forkSleeperChatFacts())
    )
    const settings = resolveLostWorkSettings(forkLostWorkStore()?.getSettings().forkLostWork)
    return { ...result, items: annotateLostWorkUse(result.items, uses, settings.inUse) }
  } catch {
    return result
  }
}

// BAD-669: the worker archive methods ride in this list, so rpc-method-registry.ts (over its line
// budget) needs no new line.
export const FORK_LOST_WORK_METHODS = [
  ...FORK_WORKER_ARCHIVE_METHODS,
  defineMethod({
    name: 'fork.lostWork.scan',
    permission: 'workspace',
    params: ForkLostWorkScanParams,
    handler: async (params, ctx) => {
      const store = forkLostWorkStore()
      if (!store) {
        throw new Error('The lost work scan runs in the Orca desktop app; open it and try again.')
      }
      const wanted = params.repo
      const result = await runForkLostWorkScan(
        store,
        ctx.signal,
        wanted ? (repo) => repo.id === wanted || repo.displayName === wanted : undefined
      )
      return withUse(result, ctx)
    }
  })
] as const
