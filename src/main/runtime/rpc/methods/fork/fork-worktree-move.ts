// SLRM-2265 (FORK.md): each host's half of moving a workspace and its chats to another host. The
// CLI or desktop that runs the move calls the source's inspect and export and the target's import;
// both hosts' stock methods (git.push, worktree.create, agentSession.create, worktree.set) do the
// rest, so nothing here reaches another machine.
import { defineMethod, type RpcContext } from '../../core'
import {
  ForkWorktreeMoveExportParams,
  ForkWorktreeMoveImportParams,
  ForkWorktreeMoveInspectParams
} from '../../../../../shared/fork/worktree-move/worktree-move-wire'
import { worktreeMoveService } from '../../../../fork/worktree-move/worktree-move-host'
import { ensureStructuredHostInstalled } from '../structured-sessions/creation/structured-agent-session-gate'

/** Chats at rest after a restart live in a host that builds lazily, like the agentSession reads. */
async function service(ctx: RpcContext) {
  await ensureStructuredHostInstalled(ctx)
  return worktreeMoveService(ctx.runtime)
}

export const FORK_WORKTREE_MOVE_METHODS = [
  defineMethod({
    name: 'fork.worktreeMove.inspect',
    permission: 'workspace',
    params: ForkWorktreeMoveInspectParams,
    handler: async (params, ctx) => (await service(ctx)).inspect(params.worktree)
  }),
  defineMethod({
    name: 'fork.worktreeMove.export',
    permission: 'workspace',
    params: ForkWorktreeMoveExportParams,
    handler: async (params, ctx) => (await service(ctx)).export(params)
  }),
  defineMethod({
    name: 'fork.worktreeMove.import',
    permission: 'workspace',
    params: ForkWorktreeMoveImportParams,
    handler: async (params, ctx) => (await service(ctx)).import(params)
  })
] as const
