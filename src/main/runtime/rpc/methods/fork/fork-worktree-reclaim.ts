// BAD-691 (FORK.md "Worktree reclaim"): `orca workspace reclaim` asks the host that owns the
// projects, since the files live there. In-use facts come from the same rows Lost work reads.
import { defineMethod, type RpcContext } from '../../core'
import { ForkWorktreeReclaimRunParams } from '../../../../../shared/fork/worktree-reclaim'
import {
  resolveLostWorkSettings,
  type LostWorkSettings
} from '../../../../../shared/fork/lost-work'
import { countedLostWorkUse } from '../../../../../shared/fork/lost-work-use'
import { sleeperSourcesFromPs } from '../../../../../shared/fork/sleepers-ps-sources'
import { lostWorkUseFromPs } from '../../../../fork/lost-work/lost-work-use-ps'
import { forkSleeperChatFacts } from '../../../../fork/sleepers/sleepers-host'
import { runForkWorktreeReclaim } from '../../../../fork/worktree-reclaim/worktree-reclaim-service'

/**
 * Which workspaces are in use. A running agent, a live terminal or the open workspace always
 * counts; the Lost work settings decide the chat signals. A host that cannot tell fails the run.
 */
async function workspaceUseCheck(
  ctx: RpcContext,
  lostWorkSettings: LostWorkSettings | undefined
): Promise<(worktreeId: string) => boolean> {
  const { worktrees } = await ctx.runtime.getWorktreePs()
  const uses = lostWorkUseFromPs(
    worktrees,
    sleeperSourcesFromPs(worktrees, forkSleeperChatFacts(), { includeWorkers: true })
  )
  const signals = {
    ...resolveLostWorkSettings(lostWorkSettings).inUse,
    runningAgents: true,
    liveTerminals: true,
    activeWorkspace: true
  }
  return (worktreeId) => countedLostWorkUse(uses.get(worktreeId), signals) !== null
}

export const FORK_WORKTREE_RECLAIM_METHODS = [
  defineMethod({
    name: 'fork.worktreeReclaim.run',
    permission: 'workspace',
    params: ForkWorktreeReclaimRunParams,
    handler: async (params, ctx) => {
      const store = ctx.runtime.requireStore()
      const inUse = await workspaceUseCheck(
        ctx,
        (store.getSettings() as { forkLostWork?: LostWorkSettings }).forkLostWork
      )
      return runForkWorktreeReclaim({ store, params, inUse, signal: ctx.signal })
    }
  })
] as const
