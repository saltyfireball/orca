// BAD-677 (FORK.md "Worktree snapshots"): `orca worktree snapshots` and `orca worktree restore`,
// through the fork.worktreeSnapshots.* RPC of the host that owns the projects.
import type { CommandHandler } from '../dispatch/dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import type { RuntimeRpcSuccess } from '../../shared/remote-runtime/rpc/runtime-rpc-envelope'
import type {
  ForkWorktreeSnapshotsListResult,
  ForkWorktreeSnapshotsPruneResult,
  ForkWorktreeSnapshotsRestoreResult
} from '../../shared/fork/worktree-snapshots'

const DAY_MS = 86_400_000

export function formatForkWorktreeSnapshots(
  result: ForkWorktreeSnapshotsListResult,
  now = Date.now()
): string {
  const lines: string[] = []
  if (!result.enabled) {
    lines.push('Snapshots are off on this host (setting forkWorktreeSnapshots).')
  }
  for (const snapshot of result.snapshots) {
    const left = Math.max(0, Math.ceil((snapshot.expiresAt - now) / DAY_MS))
    const branch = snapshot.branch ?? 'detached'
    lines.push(
      `${snapshot.id}  ${snapshot.repoName}  ${branch}  ${snapshot.files} changed file(s)  ` +
        `${new Date(snapshot.createdAt).toISOString()}  kept ${left} more day(s)  ${snapshot.path}`
    )
  }
  if (result.snapshots.length === 0) {
    lines.push('No snapshots.')
  }
  for (const note of result.notes) {
    lines.push(`Note: ${note}`)
  }
  return lines.join('\n')
}

export function formatForkWorktreeRestore(result: ForkWorktreeSnapshotsRestoreResult): string {
  const where = result.branch ? ` on branch ${result.branch}.` : ' (detached).'
  const lines = [`Restored ${result.snapshot.id} to ${result.path}${where}`]
  if (result.note) {
    lines.push(`Note: ${result.note}`)
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
        'This Orca host has no worktree snapshots. Update it and try again.'
      )
    }
    throw error
  }
}

export const FORK_WORKTREE_SNAPSHOT_HANDLERS: Record<string, CommandHandler> = {
  'worktree snapshots': async (ctx) => {
    const repo = getOptionalStringFlag(ctx.flags, 'repo')
    const params = repo ? { repo } : {}
    if (ctx.flags.has('prune')) {
      await call<ForkWorktreeSnapshotsPruneResult>(ctx, 'fork.worktreeSnapshots.prune', params)
    }
    const result = await call<ForkWorktreeSnapshotsListResult>(
      ctx,
      'fork.worktreeSnapshots.list',
      params
    )
    printResult(result, ctx.json, (value) => formatForkWorktreeSnapshots(value))
  },
  'worktree restore': async (ctx) => {
    const id = getRequiredStringFlag(ctx.flags, 'id')
    const repo = getOptionalStringFlag(ctx.flags, 'repo')
    const path = getOptionalStringFlag(ctx.flags, 'path')
    const result = await call<ForkWorktreeSnapshotsRestoreResult>(
      ctx,
      'fork.worktreeSnapshots.restore',
      { id, ...(repo ? { repo } : {}), ...(path ? { path } : {}) }
    )
    printResult(result, ctx.json, formatForkWorktreeRestore)
  }
}
