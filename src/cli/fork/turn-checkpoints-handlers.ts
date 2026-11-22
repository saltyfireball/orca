// BAD-678 (FORK.md "Turn checkpoints"): `orca checkpoint list|diff|restore|undo`, through the
// fork.turnCheckpoints.* RPC of the host that runs the workspace.
import type { CommandHandler } from '../dispatch/dispatch'
import { getRequiredStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import type { RuntimeRpcSuccess } from '../../shared/remote-runtime/rpc/runtime-rpc-envelope'
import {
  getOptionalWorktreeSelector,
  resolveCurrentWorktreeSelector
} from '../workspace-selection/workspace-selector'
import type {
  ForkTurnCheckpoint,
  ForkTurnCheckpointsDiffResult,
  ForkTurnCheckpointsListResult,
  ForkTurnCheckpointsRestoreResult
} from '../../shared/fork/turn-checkpoints'

function when(checkpoint: ForkTurnCheckpoint): string {
  return new Date(checkpoint.createdAt).toISOString()
}

export function formatForkTurnCheckpoints(result: ForkTurnCheckpointsListResult): string {
  const lines: string[] = []
  if (!result.enabled) {
    lines.push('Checkpoints are off on this host (setting forkTurnCheckpoints).')
  }
  for (const item of result.checkpoints) {
    const from = item.restoredFrom ? ` of ${item.restoredFrom}` : ''
    const who = item.agent ? `  ${item.agent}` : ''
    const prompt = item.prompt ? `  "${item.prompt.replace(/\s+/g, ' ').slice(0, 60)}"` : ''
    lines.push(
      `${item.id}  ${item.kind}${from}  ${item.files} file(s)  ${when(item)}${who}${prompt}`
    )
  }
  if (result.checkpoints.length === 0) {
    lines.push('No checkpoints yet. One is taken when an agent ends a turn that changed files.')
  }
  return lines.join('\n')
}

export function formatForkTurnCheckpointDiff(result: ForkTurnCheckpointsDiffResult): string {
  const against = result.against === 'now' ? 'the files now' : 'the checkpoint before it'
  const lines = [
    `Checkpoint ${result.checkpoint.id} against ${against}: ${result.files.length} file(s)`
  ]
  for (const file of result.files) {
    lines.push(`${file.status}  ${file.path}`)
  }
  if (result.excludedMergedFiles > 0) {
    lines.push(
      `(${result.excludedMergedFiles} file(s) a merge, pull or checkout brought in are left out)`
    )
  }
  if (result.patch) {
    lines.push('', result.patch.trimEnd())
    if (result.patchTruncated) {
      lines.push('(patch cut short)')
    }
  }
  return lines.join('\n')
}

export function formatForkTurnCheckpointRestore(result: ForkTurnCheckpointsRestoreResult): string {
  if (result.changedFiles === 0) {
    return result.note ?? 'Nothing changed.'
  }
  const lines = [
    `Restored ${result.changedFiles} file(s) to checkpoint ${result.restoredTo.id} (${when(result.restoredTo)}).`
  ]
  if (result.preRestore) {
    lines.push(`Undo with \`orca checkpoint undo\` (files before: ${result.preRestore.id}).`)
  }
  return lines.join('\n')
}

async function call<T>(
  ctx: Parameters<CommandHandler>[0],
  method: string,
  params: object
): Promise<RuntimeRpcSuccess<T>> {
  try {
    return await ctx.client.call<T>(method, params)
  } catch (error) {
    if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
      throw new RuntimeClientError(
        'incompatible_runtime',
        'This Orca host has no turn checkpoints. Update it and try again.'
      )
    }
    throw error
  }
}

async function worktreeOf(ctx: Parameters<CommandHandler>[0]): Promise<string> {
  return (
    (await getOptionalWorktreeSelector(ctx.flags, 'worktree', ctx.cwd, ctx.client)) ??
    (await resolveCurrentWorktreeSelector(ctx.cwd, ctx.client, 'worktree'))
  )
}

export const FORK_TURN_CHECKPOINT_HANDLERS: Record<string, CommandHandler> = {
  'checkpoint list': async (ctx) => {
    const worktree = await worktreeOf(ctx)
    const result = await call<ForkTurnCheckpointsListResult>(ctx, 'fork.turnCheckpoints.list', {
      worktree
    })
    printResult(result, ctx.json, formatForkTurnCheckpoints)
  },
  'checkpoint diff': async (ctx) => {
    const worktree = await worktreeOf(ctx)
    const id = getRequiredStringFlag(ctx.flags, 'id')
    const result = await call<ForkTurnCheckpointsDiffResult>(ctx, 'fork.turnCheckpoints.diff', {
      worktree,
      id,
      ...(ctx.flags.has('now') ? { now: true } : {}),
      ...(ctx.flags.has('patch') ? { patch: true } : {})
    })
    printResult(result, ctx.json, formatForkTurnCheckpointDiff)
  },
  'checkpoint restore': async (ctx) => {
    const worktree = await worktreeOf(ctx)
    const id = getRequiredStringFlag(ctx.flags, 'id')
    const result = await call<ForkTurnCheckpointsRestoreResult>(
      ctx,
      'fork.turnCheckpoints.restore',
      { worktree, id, ...(ctx.flags.has('force') ? { force: true } : {}) }
    )
    printResult(result, ctx.json, formatForkTurnCheckpointRestore)
  },
  'checkpoint undo': async (ctx) => {
    const worktree = await worktreeOf(ctx)
    const result = await call<ForkTurnCheckpointsRestoreResult>(ctx, 'fork.turnCheckpoints.undo', {
      worktree,
      ...(ctx.flags.has('force') ? { force: true } : {})
    })
    printResult(result, ctx.json, formatForkTurnCheckpointRestore)
  }
}
