// Review guides (FORK.md, SLRM-2396): `orca review-guide`, through the host's fork.reviewGuide.*
// RPC. Reading never writes; `write` starts the one paid step and `--wait` polls until it ends.
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import {
  normalizeWorktreeSelectorForCaller,
  resolveCurrentWorktreeSelector
} from '../workspace-selection/workspace-selector'
import { formatForkReviewGuide } from '../../shared/fork/review-guide'
import type {
  ForkReviewGuideState,
  ForkReviewGuideTarget
} from '../../shared/fork/review-guide-wire'

const POLL_MS = 3000
const MAX_WAIT_MS = 20 * 60_000

function incompatible(error: unknown): never {
  if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'This Orca host has no review guide commands. Update it and try again.'
    )
  }
  throw error
}

/** 42, #42 or a pull request URL, which also names the repository. */
export function parseReviewGuidePr(
  value: string | undefined
): Pick<ForkReviewGuideTarget, 'pr' | 'prRepo'> {
  const text = value?.trim() ?? ''
  const url = /^https?:\/\/([^/\s]+)\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/i.exec(text)
  const bare = /^#?(\d+)$/.exec(text)
  const number = Number(url ? url[4] : bare?.[1])
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Name a pull request: a number, #number or its URL.'
    )
  }
  return url
    ? { pr: number, prRepo: { host: url[1].toLowerCase(), owner: url[2], repo: url[3] } }
    : { pr: number }
}

async function reviewGuideTarget(ctx: HandlerContext): Promise<ForkReviewGuideTarget> {
  const pr = parseReviewGuidePr(getOptionalStringFlag(ctx.flags, 'pr'))
  const repo = getOptionalStringFlag(ctx.flags, 'repo')
  if (repo) {
    return { ...pr, repo }
  }
  const worktree = getOptionalStringFlag(ctx.flags, 'worktree')
  return {
    ...pr,
    worktree: worktree
      ? await normalizeWorktreeSelectorForCaller(worktree, ctx.cwd, ctx.client)
      : await resolveCurrentWorktreeSelector(ctx.cwd, ctx.client)
  }
}

export function formatReviewGuideState(state: ForkReviewGuideState, pr: number): string {
  if (!state.enabled) {
    return 'Review guides are off. Turn them on in Settings > Blackfish.'
  }
  const job =
    state.job?.state === 'running'
      ? `A guide for #${pr} is being written (started ${new Date(state.job.startedAt).toLocaleTimeString()}).`
      : state.job?.state === 'failed'
        ? `Writing the guide for #${pr} failed: ${state.job.error}`
        : null
  if (!state.guide) {
    return job ?? `#${pr} has no review guide yet. \`orca review-guide write ${pr}\` writes one.`
  }
  const guide = formatForkReviewGuide(state.guide, state.stale)
  return job ? `${job}\n\n${guide}` : guide
}

export const FORK_REVIEW_GUIDE_HANDLERS: Record<string, CommandHandler> = {
  'review-guide': async (ctx) => {
    const target = await reviewGuideTarget(ctx)
    const reply = await ctx.client
      .call<ForkReviewGuideState>('fork.reviewGuide.get', target)
      .catch(incompatible)
    printResult(reply, ctx.json, (state) => formatReviewGuideState(state, target.pr))
  },
  'review-guide cancel': async (ctx) => {
    const target = await reviewGuideTarget(ctx)
    const reply = await ctx.client
      .call<ForkReviewGuideState>('fork.reviewGuide.cancel', target)
      .catch(incompatible)
    printResult(reply, ctx.json, (state) => formatReviewGuideState(state, target.pr))
  },
  'review-guide write': async (ctx) => {
    const target = await reviewGuideTarget(ctx)
    let reply = await ctx.client
      .call<ForkReviewGuideState>('fork.reviewGuide.write', target)
      .catch(incompatible)
    if (ctx.flags.get('wait') === true) {
      const deadline = Date.now() + MAX_WAIT_MS
      while (reply.result.job?.state === 'running' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
        reply = await ctx.client.call<ForkReviewGuideState>('fork.reviewGuide.get', target)
      }
      const job = reply.result.job
      if (job?.state === 'failed') {
        throw new RuntimeClientError('runtime_error', job.error)
      }
    }
    printResult(reply, ctx.json, (state) => formatReviewGuideState(state, target.pr))
  }
}
