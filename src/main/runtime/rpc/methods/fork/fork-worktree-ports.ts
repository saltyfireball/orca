// Worktree ports (FORK.md, SLRM-2383): `orca ports` asks the host that runs the workspace for the
// block it holds. Reads only; asking never reserves.
import { defineMethod } from '../../core'
import {
  ForkWorktreePortsGetParams,
  type ForkWorktreePortsGetResult
} from '../../../../../shared/fork/worktree-ports-wire'
import { readForkWorktreePortBlock } from '../../../../fork/worktree-ports/worktree-ports-service'

export const FORK_WORKTREE_PORTS_METHODS = [
  defineMethod({
    name: 'fork.worktreePorts.get',
    permission: 'workspace',
    params: ForkWorktreePortsGetParams,
    handler: async (params, { runtime }): Promise<ForkWorktreePortsGetResult> => {
      const worktree = await runtime.showManagedWorktree(params.worktree)
      return { worktreeId: worktree.id, ...readForkWorktreePortBlock(worktree.id) }
    }
  })
] as const
