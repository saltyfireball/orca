// BAD-678 (FORK.md "Turn checkpoints"): `orca checkpoint list|diff|restore|undo` ask the host that
// runs the workspace, since the shadow store lives in that host's data folder.
import { defineMethod, type RpcContext } from '../../core'
import {
  ForkTurnCheckpointsDiffParams,
  ForkTurnCheckpointsListParams,
  ForkTurnCheckpointsRestoreParams,
  ForkTurnCheckpointsUndoParams
} from '../../../../../shared/fork/turn-checkpoints'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../shared/execution-host/execution-host'
import { forkTurnCheckpointService } from '../../../../fork/turn-checkpoints/turn-checkpoint-live'

async function localWorkspacePath(ctx: RpcContext, selector: string) {
  const worktree = await ctx.runtime.showManagedWorktree(selector)
  if ((worktree.hostId ?? LOCAL_EXECUTION_HOST_ID) !== LOCAL_EXECUTION_HOST_ID) {
    throw new Error(
      'Checkpoints are kept on the machine that holds the files; this workspace is on another host.'
    )
  }
  const service = forkTurnCheckpointService()
  if (!service) {
    throw new Error('This Orca host has checkpoints switched off.')
  }
  return { path: worktree.path, service }
}

export const FORK_TURN_CHECKPOINT_METHODS = [
  defineMethod({
    name: 'fork.turnCheckpoints.list',
    permission: 'workspace',
    params: ForkTurnCheckpointsListParams,
    handler: async (params, ctx) => {
      const { path, service } = await localWorkspacePath(ctx, params.worktree)
      return service.list(path)
    }
  }),
  defineMethod({
    name: 'fork.turnCheckpoints.diff',
    permission: 'workspace',
    params: ForkTurnCheckpointsDiffParams,
    handler: async (params, ctx) => {
      const { path, service } = await localWorkspacePath(ctx, params.worktree)
      return service.diff(path, params.id, { now: params.now, patch: params.patch })
    }
  }),
  defineMethod({
    name: 'fork.turnCheckpoints.restore',
    permission: 'workspace',
    params: ForkTurnCheckpointsRestoreParams,
    handler: async (params, ctx) => {
      const { path, service } = await localWorkspacePath(ctx, params.worktree)
      return service.restore(path, params.id, { force: params.force })
    }
  }),
  defineMethod({
    name: 'fork.turnCheckpoints.undo',
    permission: 'workspace',
    params: ForkTurnCheckpointsUndoParams,
    handler: async (params, ctx) => {
      const { path, service } = await localWorkspacePath(ctx, params.worktree)
      return service.undo(path, { force: params.force })
    }
  })
] as const
