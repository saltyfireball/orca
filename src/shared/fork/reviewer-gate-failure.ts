// Reviewer gate (BAD-820, FORK.md): when a finished reviewer run is not a review.
import type { ReviewVerdict } from './reviewer-gate'

/** What the reviewing tool's own sandbox or launch prints when it could not run the review at all. */
const REVIEWER_FAILURE_SIGNATURES = [
  /\bbwrap:/u,
  /\bRTM_NEWADDR\b/u,
  /\bsandbox-exec:/u,
  /failed to (?:create|set up|initialize|start) (?:the |a )?sandbox/iu
]

/**
 * BAD-820: why a run that ended is not a review, or null when it is one. A reviewer whose own
 * sandbox failed can still end with a VERDICT line (the model writes one after every tool call
 * failed), so a verdict alone is not proof that anything was read.
 */
export function reviewerFailureReason(input: {
  output: string
  exitCode: number | null
  verdict: ReviewVerdict
}): string | null {
  const lines = input.output.replace(/\r\n?/gu, '\n').split('\n')
  const signature = lines.find((line) =>
    REVIEWER_FAILURE_SIGNATURES.some((pattern) => pattern.test(line))
  )
  if (signature) {
    return `the reviewer's own sandbox failed (${signature.trim().slice(0, 160)})`
  }
  if (input.output.trim() === '') {
    return `the reviewer printed nothing (exit ${input.exitCode ?? 'none'})`
  }
  if (input.verdict.kind === 'unreadable') {
    return `the reviewer ended (exit ${input.exitCode ?? 'none'}) without a VERDICT line`
  }
  return null
}
