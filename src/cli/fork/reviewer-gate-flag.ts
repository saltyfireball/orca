// Reviewer gate (BAD-683, FORK.md): `--review`, `--review-focus`, `--review-agent` and
// `--review-max-rounds` on `orchestration task-create` and `worker-start`. A host without the gate
// drops the params, as it does any param it does not know.
import { REVIEW_AGENTS, REVIEW_FOCUSES } from '../../shared/fork/reviewer-gate'
import { getOptionalNumberFlag, getOptionalStringFlag } from '../arguments/flags'
import { RuntimeClientError } from '../runtime/connection/types'

export const FORK_REVIEW_FLAGS = [
  'review',
  'review-focus',
  'review-agent',
  'review-max-rounds'
] as const

function oneOf<T extends string>(
  flag: string,
  value: string | undefined,
  allowed: readonly T[]
): T | undefined {
  if (value === undefined) {
    return undefined
  }
  const found = allowed.find((item) => item === value)
  if (!found) {
    throw new RuntimeClientError('invalid_argument', `--${flag} takes ${allowed.join(', ')}.`)
  }
  return found
}

export function readForkReviewGateFlags(flags: Map<string, string | boolean>): {
  forkReview?: true
  forkReviewFocus?: (typeof REVIEW_FOCUSES)[number]
  forkReviewAgent?: (typeof REVIEW_AGENTS)[number]
  forkReviewMaxRounds?: number
} {
  const asked = FORK_REVIEW_FLAGS.some((flag) => flags.has(flag))
  if (!asked) {
    return {}
  }
  const focus = oneOf('review-focus', getOptionalStringFlag(flags, 'review-focus'), REVIEW_FOCUSES)
  const agent = oneOf('review-agent', getOptionalStringFlag(flags, 'review-agent'), REVIEW_AGENTS)
  const maxRounds = getOptionalNumberFlag(flags, 'review-max-rounds')
  if (
    maxRounds !== undefined &&
    (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 10)
  ) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--review-max-rounds takes a whole number from 1 to 10.'
    )
  }
  // A focus, agent or round limit alone is a request for a review.
  return {
    forkReview: true,
    ...(focus ? { forkReviewFocus: focus } : {}),
    ...(agent ? { forkReviewAgent: agent } : {}),
    ...(maxRounds !== undefined ? { forkReviewMaxRounds: maxRounds } : {})
  }
}
