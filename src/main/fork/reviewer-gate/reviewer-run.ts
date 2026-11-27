// Reviewer gate (BAD-683, BAD-820, FORK.md): running one review to its end. A run that is not a
// review (the reviewing tool's sandbox failed, empty output, no verdict) is an error, retried here,
// never a finding.
import { createHash } from 'node:crypto'
import {
  cleanLetter,
  exhaustedLetter,
  findingsLetter,
  findingsText,
  parseReviewVerdict,
  REVIEWER_GATE_MAX_ERRORS_PER_HEAD,
  reviewCommandLine,
  reviewErrorLetter,
  reviewEscalationText,
  type ReviewRunRecord
} from '../../../shared/fork/reviewer-gate'
import { reviewerFailureReason } from '../../../shared/fork/reviewer-gate-failure'
import { tailLines } from '../../../shared/fork/completion-contract'
import { notifyForkInboxSourceChanged } from '../idle-recovery/idle-recovery-sources'
import {
  finishReviewRun,
  setReviewEscalated,
  setReviewWorkerTold,
  type ReviewWorkerTold
} from './reviewer-store'
import type { ReviewGateDeps, ReviewGateRequest, ReviewWorkspace } from './reviewer-gate'

const HEAD_COMMAND =
  'git rev-parse HEAD && git status --porcelain=v1 -uall 2>&1 && git diff HEAD 2>&1'
const DELIVERY_ATTEMPT_DELAYS_MS = [3000, 6000, 12_000, 24_000, 48_000, 60_000, 60_000, 60_000]

/** A counting gate for the reviews running at once on this host. */
const waiting: (() => void)[] = []
let running = 0

async function withReviewSlot<T>(limit: number, run: () => Promise<T>): Promise<T> {
  while (running >= limit) {
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  running += 1
  try {
    return await run()
  } finally {
    running -= 1
    waiting.shift()?.()
  }
}

export type Head = { sha: string; key: string }

export async function readHead(workspace: ReviewWorkspace): Promise<Head | null> {
  const raw = await workspace.runner(workspace.target, HEAD_COMMAND, 60_000)
  const sha = raw.output.split('\n')[0]?.trim() ?? ''
  if (raw.exitCode !== 0 || !/^[0-9a-f]{40,64}$/u.test(sha)) {
    return null
  }
  return { sha, key: createHash('sha1').update(raw.output).digest('hex') }
}

async function deliverWithRetry(
  deps: ReviewGateDeps,
  dispatchId: string,
  text: string
): Promise<boolean> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  for (let attempt = 0; attempt <= DELIVERY_ATTEMPT_DELAYS_MS.length; attempt += 1) {
    const delivered = await deps.deliver(dispatchId, text).catch(() => false)
    if (delivered === 'unreachable') {
      return false
    }
    if (delivered) {
      return true
    }
    const delay = DELIVERY_ATTEMPT_DELAYS_MS[attempt]
    if (delay === undefined) {
      return false
    }
    await sleep(delay)
  }
  return false
}

/**
 * BAD-820: tells the worker the result and records how. A worker whose chat or terminal would not
 * take the text (an idle terminal worker on a host that cannot prove its prompt is empty) still
 * gets it in its orchestration mailbox, so a result is never dropped in silence.
 */
async function tellWorker(
  deps: ReviewGateDeps,
  request: ReviewGateRequest,
  text: string
): Promise<void> {
  let told: ReviewWorkerTold = 'not-told'
  if (await deliverWithRetry(deps, request.dispatchId, text)) {
    told = 'sent'
  } else if (deps.mail && (await deps.mail(request.dispatchId, text).catch(() => false))) {
    told = 'mailed'
  }
  try {
    setReviewWorkerTold(deps.db, request.taskId, told)
    notifyForkInboxSourceChanged()
  } catch {
    // The record only words the inbox row; the worker was already told (or not) above.
  }
}

function letterFor(run: ReviewRunRecord, maxRounds: number): string {
  if (run.status === 'clean') {
    return cleanLetter(run)
  }
  if (run.status === 'findings') {
    return run.round > maxRounds
      ? exhaustedLetter(run, maxRounds)
      : findingsLetter({ run, maxRounds })
  }
  return reviewErrorLetter(run)
}

export type ReviewInput = {
  runId: number
  request: ReviewGateRequest
  workspace: ReviewWorkspace
  head: Head
  prompt: string
  template: string
  model: string
  maxRounds: number
  /** Records another run of the same head, for a retry. */
  startAgain: () => number
}

/** One run of the reviewer, recorded. A run that is not a review is an error, never a finding. */
async function attemptReview(deps: ReviewGateDeps, input: ReviewInput): Promise<ReviewRunRecord> {
  const settings = deps.settings()
  const { workspace, head } = input
  try {
    const result = await withReviewSlot(settings.maxConcurrent, async () => {
      const command = reviewCommandLine({
        template: input.template,
        prompt: input.prompt,
        model: input.model,
        platform: deps.platform ?? process.platform
      })
      const raw = await workspace.runner(workspace.target, command, settings.timeoutMs)
      const after = await readHead(workspace)
      return { raw, changed: !after || after.key !== head.key }
    })
    const verdict = parseReviewVerdict(result.raw.output)
    const failure = reviewerFailureReason({
      output: result.raw.output,
      exitCode: result.raw.exitCode,
      verdict
    })
    if (result.changed) {
      return finishReviewRun(deps.db, input.runId, {
        status: 'error',
        findingsCount: 0,
        output:
          'The checkout changed while the reviewer ran (a read-only reviewer must not change it). The review is not trusted.'
      })
    }
    if (result.raw.timedOut) {
      return finishReviewRun(deps.db, input.runId, {
        status: 'error',
        findingsCount: 0,
        output: `The review did not finish within ${Math.round(settings.timeoutMs / 1000)} seconds.\n${tailLines(result.raw.output, 20)}`
      })
    }
    if (failure || verdict.kind === 'unreadable') {
      return finishReviewRun(deps.db, input.runId, {
        status: 'error',
        findingsCount: 0,
        output: `${failure ?? 'the reviewer gave no verdict'}\n${tailLines(result.raw.output, 30)}`
      })
    }
    return finishReviewRun(deps.db, input.runId, {
      status: verdict.kind === 'clean' ? 'clean' : 'findings',
      findingsCount: verdict.kind === 'clean' ? 0 : verdict.count,
      output: findingsText(result.raw.output, settings.outputLines)
    })
  } catch (error) {
    return finishReviewRun(deps.db, input.runId, {
      status: 'error',
      findingsCount: 0,
      output: error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * Runs the review of one head to the end, records it and tells the worker. A run that errored is
 * retried here, up to REVIEWER_GATE_MAX_ERRORS_PER_HEAD runs; a reviewer that still cannot run
 * escalates to the coordinator and the worker is told to wait (BAD-820). Never throws.
 */
export async function runReview(deps: ReviewGateDeps, input: ReviewInput): Promise<void> {
  const { request } = input
  let record = await attemptReview(deps, input)
  for (
    let run = 1;
    record.status === 'error' && run < REVIEWER_GATE_MAX_ERRORS_PER_HEAD;
    run += 1
  ) {
    record = await attemptReview(deps, { ...input, runId: input.startAgain() })
  }
  if (record.status === 'error') {
    try {
      setReviewEscalated(deps.db, request.taskId, true)
      await deps.escalate?.({
        taskId: request.taskId,
        dispatchId: request.dispatchId,
        text: reviewEscalationText({
          taskId: request.taskId,
          run: record,
          reason: 'errors',
          maxRounds: input.maxRounds
        })
      })
    } catch {
      // The Decision inbox row and the next done still carry it.
    }
  }
  await tellWorker(deps, request, letterFor(record, input.maxRounds))
}
