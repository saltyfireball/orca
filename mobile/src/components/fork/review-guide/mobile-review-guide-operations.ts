// Review guides (SLRM-2396, FORK.md): the phone's fork.reviewGuide.* calls, each reply checked
// against the shared schema before the view reads it.
import { defineRpcOperation, runRpcOperation } from '../../../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../../../transport/rpc/rpc-operation-result-reader'
import type { UnvalidatedRpcRequestPort } from '../../../transport/rpc/unvalidated-rpc-request-port'
import {
  ForkReviewGuideStateSchema,
  type ForkReviewGuideState
} from '../../../../../src/shared/fork/review-guide-wire'
import type { GitHubPrRepoSlug } from '../../../source-control/review/github-operations/github-pr-repo-slug'

const read = rpcResultVariant('review-guide-state', ForkReviewGuideStateSchema)

const getOperation = defineRpcOperation({
  name: 'fork.review-guide-get',
  method: 'fork.reviewGuide.get',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read
})

const writeOperation = defineRpcOperation({
  name: 'fork.review-guide-write',
  method: 'fork.reviewGuide.write',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read
})

const cancelOperation = defineRpcOperation({
  name: 'fork.review-guide-cancel',
  method: 'fork.reviewGuide.cancel',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read
})

export type MobileReviewGuideTarget = {
  worktreeId: string
  pr: number
  prRepo: GitHubPrRepoSlug | null
}

function target(input: MobileReviewGuideTarget) {
  return {
    worktree: `id:${input.worktreeId}`,
    pr: input.pr,
    ...(input.prRepo
      ? {
          prRepo: {
            owner: input.prRepo.owner,
            repo: input.prRepo.repo,
            ...(input.prRepo.host ? { host: input.prRepo.host } : {})
          }
        }
      : {})
  }
}

export function readMobileReviewGuide(
  client: UnvalidatedRpcRequestPort,
  input: MobileReviewGuideTarget,
  headSha: string | null
): Promise<ForkReviewGuideState> {
  return runRpcOperation(client, getOperation, {
    ...target(input),
    ...(headSha ? { headSha } : {})
  })
}

export function writeMobileReviewGuide(
  client: UnvalidatedRpcRequestPort,
  input: MobileReviewGuideTarget
): Promise<ForkReviewGuideState> {
  return runRpcOperation(client, writeOperation, target(input))
}

export function cancelMobileReviewGuide(
  client: UnvalidatedRpcRequestPort,
  input: MobileReviewGuideTarget
): Promise<ForkReviewGuideState> {
  return runRpcOperation(client, cancelOperation, target(input))
}
