// Reviewer gate (BAD-763): the line a done carries when a review the Task asked for did not run.
import { hostname } from 'node:os'
import { skippedLine } from '../../../shared/fork/completion-contract'
import type { ReviewGateState } from '../../../shared/fork/reviewer-gate'
import { recordSkip, type ContractDbHandle } from '../completion-contract/contract-store'

export type ReviewSkipOutcome = { kind: 'none' } | { kind: 'skipped'; note: string }

/**
 * Only a review the Task asked for is owed a line; one the all-Tasks setting made (`implicit`) or
 * none at all stays silent. The note is kept as a skipped attempt for `orca contract show`.
 */
export function reviewSkipped(
  db: ContractDbHandle,
  request: { taskId: string; dispatchId: string },
  state: ReviewGateState | null,
  why: string,
  host: (() => string) | undefined
): ReviewSkipOutcome {
  if (!state || state.implicit) {
    return { kind: 'none' }
  }
  const note = skippedLine('the review this Task asked for', why, (host ?? hostname)())
  recordSkip(db, request.taskId, request.dispatchId, note)
  return { kind: 'skipped', note }
}
