// BAD-642 (FORK.md "Bot items: workers on a paired server"): one read of a bot item's server worker,
// asked of the server that runs it, as `orca orchestration worker-show --environment` reads it.
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type { RuntimeClientTarget } from '../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import {
  forkServerWorkerSeenAt,
  forkServerWorkerState,
  forkServerWorkerWorktree,
  type ForkServerWorkerRead,
  type ForkServerWorkerShow
} from '../../../../shared/fork/bot-server-worker'

// A slow server only drops the read: the item keeps its host's record meanwhile.
const READ_TIMEOUT_MS = 10_000

export type ForkServerCall = <T>(
  target: RuntimeClientTarget,
  method: string,
  params: unknown,
  options: { timeoutMs: number }
) => Promise<T>

type ServerWorktree = { worktree: { linkedPR?: number | null; repoId?: string | null } }
type RepoSlug = { owner: string; repo: string } | null

/** The worker as its server shows it, or null when the server has no such worker. Throws when the
 *  server can't be reached; a workspace or PR read that fails only leaves the PR out. */
export async function readForkServerWorker(
  environmentId: string,
  dispatchId: string,
  call: ForkServerCall = callRuntimeRpc
): Promise<ForkServerWorkerRead | null> {
  const target: RuntimeClientTarget = { kind: 'environment', environmentId }
  const options = { timeoutMs: READ_TIMEOUT_MS }
  const show = await call<ForkServerWorkerShow>(
    target,
    'orchestration.workerShow',
    { dispatch: dispatchId },
    options
  )
  const state = forkServerWorkerState(show)
  if (!state) {
    return null
  }
  const worktreeId = forkServerWorkerWorktree(show)
  return {
    state,
    worktreeId,
    seenAt: forkServerWorkerSeenAt(show),
    pr: worktreeId ? await linkedPr(target, worktreeId, call, options).catch(() => null) : null
  }
}

/** The workspace's linked GitHub PR, its URL from the repository's slug on the server. */
async function linkedPr(
  target: RuntimeClientTarget,
  worktreeId: string,
  call: ForkServerCall,
  options: { timeoutMs: number }
): Promise<ForkServerWorkerRead['pr']> {
  const { worktree } = await call<ServerWorktree>(
    target,
    'worktree.show',
    { worktree: `id:${worktreeId}` },
    options
  )
  const number = worktree.linkedPR
  if (!number || !worktree.repoId) {
    return null
  }
  const slug = await call<RepoSlug>(
    target,
    'github.repoSlug',
    { repo: `id:${worktree.repoId}` },
    options
  )
  return slug
    ? { number, url: `https://github.com/${slug.owner}/${slug.repo}/pull/${number}` }
    : null
}
