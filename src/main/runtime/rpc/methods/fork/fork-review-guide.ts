// Review guides (SLRM-2396, FORK.md): `orca review-guide` and the phone's guide view. A guide is
// read and written on the host that holds the checkout; a workspace on an SSH host is refused.
// No method here touches GitHub's viewed marks.
import { defineMethod, type RpcContext } from '../../core'
import {
  ForkReviewGuideCancelParams,
  ForkReviewGuideGetParams,
  ForkReviewGuideWriteParams,
  type ForkReviewGuideState,
  type ForkReviewGuideTarget
} from '../../../../../shared/fork/review-guide-wire'
import {
  getRepoRoutingConnectionId,
  LOCAL_EXECUTION_HOST_ID
} from '../../../../../shared/execution-host/execution-host'
import {
  forkReviewGuideLocalCheckout,
  forkReviewGuideService,
  type ForkReviewGuideCheckout,
  type ForkReviewGuideHost
} from '../../../../fork/review-guide/review-guide-service'

async function resolve(
  ctx: RpcContext,
  params: ForkReviewGuideTarget
): Promise<{ host: ForkReviewGuideHost; checkout: ForkReviewGuideCheckout }> {
  const store = ctx.runtime.requireStore()
  const host = {
    settings: store.getSettings(),
    agentEnvironment: ctx.runtime.getCommitMessageAgentEnvironmentResolvers()
  }
  const prRepo = params.prRepo ?? null
  if (params.repo) {
    const wanted = params.repo
    const id = wanted.startsWith('id:') ? wanted.slice(3) : wanted
    const checkout = forkReviewGuideLocalCheckout(
      store.getRepos(),
      (repo) => repo.id === id || repo.displayName === wanted,
      params.pr,
      prRepo
    )
    return { host, checkout }
  }
  if (!params.worktree) {
    throw new Error('Name a workspace or a project.')
  }
  const worktree = await ctx.runtime.showManagedWorktree(params.worktree)
  if ((worktree.hostId ?? LOCAL_EXECUTION_HOST_ID) !== LOCAL_EXECUTION_HOST_ID) {
    throw new Error(
      'Review guides are written on the machine that holds the checkout; this workspace is on another host.'
    )
  }
  const repo = store.getRepos().find((entry) => entry.id === worktree.repoId) ?? null
  if (repo && getRepoRoutingConnectionId(repo)) {
    throw new Error(
      'Review guides are written on the machine that holds the checkout; this project is on an SSH host.'
    )
  }
  return { host, checkout: { repoPath: worktree.path, repo, pr: params.pr, prRepo } }
}

export const FORK_REVIEW_GUIDE_METHODS = [
  defineMethod({
    name: 'fork.reviewGuide.get',
    permission: 'workspace',
    params: ForkReviewGuideGetParams,
    handler: async (params, ctx): Promise<ForkReviewGuideState> => {
      const { host, checkout } = await resolve(ctx, params)
      return forkReviewGuideService().state(host, checkout, params.headSha ?? null)
    }
  }),
  defineMethod({
    name: 'fork.reviewGuide.write',
    permission: 'workspace',
    params: ForkReviewGuideWriteParams,
    handler: async (params, ctx): Promise<ForkReviewGuideState> => {
      const { host, checkout } = await resolve(ctx, params)
      return forkReviewGuideService().write(host, checkout)
    }
  }),
  defineMethod({
    name: 'fork.reviewGuide.cancel',
    permission: 'workspace',
    params: ForkReviewGuideCancelParams,
    handler: async (params, ctx): Promise<ForkReviewGuideState> => {
      const { host, checkout } = await resolve(ctx, params)
      return forkReviewGuideService().cancel(host, checkout)
    }
  })
] as const
