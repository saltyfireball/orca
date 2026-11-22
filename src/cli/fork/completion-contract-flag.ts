// Completion contract (BAD-676, FORK.md): `--done-check`, `--require-pr-checks` and
// `--done-max-rounds` on `orchestration task-create` and `worker-start`. A host without the
// contract drops the params, as it does any param it does not know.
import {
  FORK_DONE_CHECK_MAX_COUNT,
  FORK_DONE_CHECK_MAX_LENGTH
} from '../../shared/fork/completion-contract'
import { getOptionalNumberFlag, getRepeatedStringFlag } from '../arguments/flags'
import { RuntimeClientError } from '../runtime/connection/types'
import { readForkReviewGateFlags } from './reviewer-gate-flag'

export const FORK_DONE_CHECK_FLAG = 'done-check'
export const FORK_REQUIRE_PR_CHECKS_FLAG = 'require-pr-checks'
export const FORK_DONE_MAX_ROUNDS_FLAG = 'done-max-rounds'
export const FORK_DONE_CONTRACT_FLAGS = [
  FORK_DONE_CHECK_FLAG,
  FORK_REQUIRE_PR_CHECKS_FLAG,
  FORK_DONE_MAX_ROUNDS_FLAG
]

/** The done checks (BAD-676) and, riding the same hook, the review request (BAD-683). */
export function readForkDoneContractFlags(
  flags: Map<string, string | boolean>
): ReturnType<typeof readForkDoneChecksFlags> & ReturnType<typeof readForkReviewGateFlags> {
  return { ...readForkDoneChecksFlags(flags), ...readForkReviewGateFlags(flags) }
}

function readForkDoneChecksFlags(flags: Map<string, string | boolean>): {
  forkDoneChecks?: string[]
  forkRequirePrChecks?: true
  forkDoneMaxRounds?: number
} {
  const checks = getRepeatedStringFlag(flags, FORK_DONE_CHECK_FLAG).map((check) => check.trim())
  if (flags.has(FORK_DONE_CHECK_FLAG) && checks.length === 0) {
    throw new RuntimeClientError('invalid_argument', '--done-check takes a shell command to run.')
  }
  if (
    checks.length > FORK_DONE_CHECK_MAX_COUNT ||
    checks.some((check) => check.length === 0 || check.length > FORK_DONE_CHECK_MAX_LENGTH)
  ) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--done-check takes up to ${FORK_DONE_CHECK_MAX_COUNT} commands of at most ${FORK_DONE_CHECK_MAX_LENGTH} characters each.`
    )
  }
  const maxRounds = getOptionalNumberFlag(flags, FORK_DONE_MAX_ROUNDS_FLAG)
  if (
    maxRounds !== undefined &&
    (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 10)
  ) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--done-max-rounds takes a whole number from 1 to 10.'
    )
  }
  return {
    ...(checks.length > 0 ? { forkDoneChecks: checks } : {}),
    ...(flags.has(FORK_REQUIRE_PR_CHECKS_FLAG) ? { forkRequirePrChecks: true as const } : {}),
    ...(maxRounds !== undefined ? { forkDoneMaxRounds: maxRounds } : {})
  }
}
