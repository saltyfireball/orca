// Reviewer gate (BAD-683, FORK.md): the rule a worker_done passes when its Task asks for a review.
// The first report of a head starts one read-only reviewer on that exact head and is held; the
// result is told to the worker as a message (findings, or clean, or a failure), and the worker
// reports again: a clean head settles, findings bounce. A Task that asks for no review is not
// touched. Ports are injected so the state machine runs under test with a stub reviewer.
import { createHash } from 'node:crypto'
import {
  cleanLetter,
  decideReview,
  effectiveReviewGate,
  exhaustedLetter,
  findingsLetter,
  findingsText,
  parseReviewVerdict,
  repeatedHeadText,
  reviewCommandLine,
  reviewErrorLetter,
  reviewEscalationText,
  reviewEvidenceText,
  reviewPrompt,
  reviewRunningText,
  reviewStartedText,
  reviewerAgentFor,
  type ReviewerGateSettings,
  type ReviewRunRecord
} from '../../../shared/fork/reviewer-gate'
import { tailLines } from '../../../shared/fork/completion-contract'
import type { CheckRunner, CheckTarget } from '../completion-contract/check-runner'
import {
  countErrorRunsOfHead,
  countFindingRuns,
  finishReviewRun,
  latestRunOfHead,
  readReviewGate,
  saveReviewGate,
  setRepeatReports,
  setReviewEscalated,
  startReviewRun,
  type ReviewDbHandle
} from './reviewer-store'

export type ReviewWorkspace = {
  target: CheckTarget
  /** A folder (non-git) project has no commit to review. */
  git: boolean
  runner: CheckRunner
}

export type ReviewGateDeps = {
  db: ReviewDbHandle
  settings: () => ReviewerGateSettings
  workspace: (worktreeId: string | null) => Promise<ReviewWorkspace | null>
  /** The agent kind the worker runs, from how it was started. */
  workerAgent: (dispatchId: string) => string | null
  /** Tells the worker a result; false when it could not be delivered. */
  deliver: (dispatchId: string, text: string) => Promise<boolean>
  platform?: NodeJS.Platform
  /** Waits between delivery attempts. */
  sleep?: (ms: number) => Promise<void>
}

export type ReviewGateRequest = {
  taskId: string
  dispatchId: string
  worktreeId: string | null
  /** Only a succeeded report is reviewed; a worker that says it failed is not asked to prove it. */
  outcome: 'succeeded' | 'failed'
}

export type ReviewGateOutcome =
  | { kind: 'none' }
  | { kind: 'pass'; evidence: string }
  /** The report is turned back; the Task stays open. */
  | { kind: 'hold'; text: string }
  | { kind: 'escalate'; text: string }

const HEAD_COMMAND =
  'git rev-parse HEAD && git status --porcelain=v1 -uall 2>&1 && git diff HEAD 2>&1'
const DELIVERY_ATTEMPT_DELAYS_MS = [3000, 6000, 12_000, 24_000, 48_000, 60_000, 60_000, 60_000]

const chains = new Map<string, Promise<unknown>>()

/** One gate step at a time per Task, so two reports cannot start two reviews of one head. */
function serial<T>(taskId: string, run: () => Promise<T>): Promise<T> {
  const next = (chains.get(taskId) ?? Promise.resolve()).catch(() => undefined).then(run)
  chains.set(taskId, next)
  void next.finally(() => {
    if (chains.get(taskId) === next) {
      chains.delete(taskId)
    }
  })
  return next
}

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

type Head = { sha: string; key: string }

async function readHead(workspace: ReviewWorkspace): Promise<Head | null> {
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
): Promise<void> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  for (let attempt = 0; attempt <= DELIVERY_ATTEMPT_DELAYS_MS.length; attempt += 1) {
    if (await deps.deliver(dispatchId, text).catch(() => false)) {
      return
    }
    const delay = DELIVERY_ATTEMPT_DELAYS_MS[attempt]
    if (delay === undefined) {
      return
    }
    await sleep(delay)
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

/** Runs the review of one head to the end, records it and tells the worker. Never throws. */
async function runReview(
  deps: ReviewGateDeps,
  input: {
    runId: number
    request: ReviewGateRequest
    workspace: ReviewWorkspace
    head: Head
    prompt: string
    template: string
    model: string
    maxRounds: number
  }
): Promise<void> {
  const settings = deps.settings()
  const { workspace, head, request } = input
  let record: ReviewRunRecord
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
    if (result.changed) {
      record = finishReviewRun(deps.db, input.runId, {
        status: 'error',
        findingsCount: 0,
        output:
          'The checkout changed while the reviewer ran (a read-only reviewer must not change it). The review is not trusted.'
      })
    } else if (result.raw.timedOut) {
      record = finishReviewRun(deps.db, input.runId, {
        status: 'error',
        findingsCount: 0,
        output: `The review did not finish within ${Math.round(settings.timeoutMs / 1000)} seconds.\n${tailLines(result.raw.output, 20)}`
      })
    } else if (verdict.kind === 'unreadable') {
      record = finishReviewRun(deps.db, input.runId, {
        status: 'error',
        findingsCount: 0,
        output: `The reviewer ended (exit ${result.raw.exitCode ?? 'none'}) without a VERDICT line.\n${tailLines(result.raw.output, 30)}`
      })
    } else if (verdict.kind === 'clean') {
      record = finishReviewRun(deps.db, input.runId, {
        status: 'clean',
        findingsCount: 0,
        output: findingsText(result.raw.output, settings.outputLines)
      })
    } else {
      record = finishReviewRun(deps.db, input.runId, {
        status: 'findings',
        findingsCount: verdict.count,
        output: findingsText(result.raw.output, settings.outputLines)
      })
    }
  } catch (error) {
    record = finishReviewRun(deps.db, input.runId, {
      status: 'error',
      findingsCount: 0,
      output: error instanceof Error ? error.message : String(error)
    })
  }
  await deliverWithRetry(deps, request.dispatchId, letterFor(record, input.maxRounds))
}

export function runReviewGate(
  deps: ReviewGateDeps,
  request: ReviewGateRequest
): Promise<ReviewGateOutcome> {
  return serial(request.taskId, async () => {
    const settings = deps.settings()
    if (!settings.enabled || request.outcome !== 'succeeded') {
      return { kind: 'none' }
    }
    let state = readReviewGate(deps.db, request.taskId)
    const gate = effectiveReviewGate(state?.gate ?? null, settings)
    if (!gate) {
      return { kind: 'none' }
    }
    if (!state) {
      saveReviewGate(deps.db, request.taskId, gate)
      state = readReviewGate(deps.db, request.taskId)
    }
    if (!state) {
      return { kind: 'none' }
    }
    const maxRounds = gate.maxRounds ?? settings.maxRounds
    const workspace = await deps.workspace(request.worktreeId)
    if (workspace && !workspace.git) {
      return { kind: 'none' }
    }
    const head = workspace ? await readHead(workspace) : null
    if (!workspace || !head) {
      setReviewEscalated(deps.db, request.taskId, true)
      return {
        kind: 'escalate',
        text: reviewEscalationText({
          taskId: request.taskId,
          run: null,
          reason: 'errors',
          maxRounds,
          detail: 'Orca could not read the worker checkout or its head commit to review it.'
        })
      }
    }
    const decision = decideReview({
      state,
      maxRounds,
      latest: latestRunOfHead(deps.db, request.taskId, head.key),
      errorsOnHead: countErrorRunsOfHead(deps.db, request.taskId, head.key)
    })
    switch (decision.action) {
      case 'settle':
        setReviewEscalated(deps.db, request.taskId, false)
        return { kind: 'pass', evidence: reviewEvidenceText(decision.run) }
      case 'wait':
        return {
          kind: 'hold',
          text: reviewRunningText(latestRunOfHead(deps.db, request.taskId, head.key)!)
        }
      case 'bounce':
        setRepeatReports(deps.db, request.taskId, state.repeatReports + 1)
        return { kind: 'hold', text: repeatedHeadText(decision.run, maxRounds) }
      case 'escalate':
        setReviewEscalated(deps.db, request.taskId, true)
        return {
          kind: 'escalate',
          text: reviewEscalationText({
            taskId: request.taskId,
            run: decision.run,
            reason: decision.reason,
            maxRounds
          })
        }
      case 'start': {
        const reviewer = reviewerAgentFor(deps.workerAgent(request.dispatchId), gate.agent)
        const model = settings.model
        const runId = startReviewRun(deps.db, {
          taskId: request.taskId,
          round: countFindingRuns(deps.db, request.taskId) + 1,
          headKey: head.key,
          headSha: head.sha,
          reviewer,
          model: model || 'default'
        })
        setRepeatReports(deps.db, request.taskId, 0)
        void runReview(deps, {
          runId,
          request,
          workspace,
          head,
          prompt: reviewPrompt({ headSha: head.sha, focus: gate.focus }),
          template: settings.commands[reviewer],
          model,
          maxRounds
        })
        return { kind: 'hold', text: reviewStartedText({ reviewer, headSha: head.sha }) }
      }
    }
  })
}
