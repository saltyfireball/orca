// Reviewer gate (BAD-683, FORK.md): the rule a worker_done passes when its Task asks for a review.
// The first report of a head starts one read-only reviewer on that exact head and is held; the
// result is told to the worker as a message (findings, or clean, or a failure), and the worker
// reports again: a clean head settles, findings bounce. A Task that asks for no review is not
// touched. Ports are injected so the state machine runs under test with a stub reviewer.
import {
  decideReview,
  effectiveReviewGate,
  repeatedHeadText,
  reviewEscalationText,
  reviewEvidenceText,
  reviewPrompt,
  reviewRunningText,
  reviewStartedText,
  reviewerAgentFor,
  type ReviewerGateSettings
} from '../../../shared/fork/reviewer-gate'
import { readHead, runReview } from './reviewer-run'
import { reviewSkipped } from './reviewer-skip'
import type { CheckRunner, CheckTarget } from '../completion-contract/check-runner'
import {
  countErrorRunsOfHead,
  countFindingRuns,
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
  /** The name of this host, for the line a skipped review leaves. */
  host?: () => string
  /** Tells the coordinator a review could not run (BAD-820); best effort, the Decision inbox row is the record. */
  escalate?: (input: { taskId: string; dispatchId: string; text: string }) => Promise<void>
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
  /** A review the Task asked for did not run; the done says so. */
  | { kind: 'skipped'; note: string }
  /** The report is turned back; the Task stays open. */
  | { kind: 'hold'; text: string }
  | { kind: 'escalate'; text: string }

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

export function runReviewGate(
  deps: ReviewGateDeps,
  request: ReviewGateRequest
): Promise<ReviewGateOutcome> {
  return serial(request.taskId, async () => {
    const settings = deps.settings()
    if (request.outcome !== 'succeeded') {
      return { kind: 'none' }
    }
    let state = readReviewGate(deps.db, request.taskId)
    const skip = (why: string): ReviewGateOutcome =>
      reviewSkipped(deps.db, request, state, why, deps.host)
    if (!settings.enabled) {
      return skip('the reviewer gate setting (forkReviewerGate) is off')
    }
    const gate = effectiveReviewGate(state?.gate ?? null, settings)
    if (!gate) {
      return { kind: 'none' }
    }
    if (!state) {
      saveReviewGate(deps.db, request.taskId, gate, true)
      state = readReviewGate(deps.db, request.taskId)
    }
    if (!state) {
      return { kind: 'none' }
    }
    const maxRounds = gate.maxRounds ?? settings.maxRounds
    const workspace = await deps.workspace(request.worktreeId)
    if (workspace && !workspace.git) {
      return skip('the workspace is a folder, which has no commit to review')
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
        const startRun = (): number =>
          startReviewRun(deps.db, {
            taskId: request.taskId,
            round: countFindingRuns(deps.db, request.taskId) + 1,
            headKey: head.key,
            headSha: head.sha,
            reviewer,
            model: model || 'default'
          })
        const runId = startRun()
        setRepeatReports(deps.db, request.taskId, 0)
        setReviewEscalated(deps.db, request.taskId, false)
        void runReview(deps, {
          runId,
          request,
          workspace,
          head,
          prompt: reviewPrompt({ headSha: head.sha, focus: gate.focus }),
          template: settings.commands[reviewer],
          model,
          maxRounds,
          startAgain: startRun
        })
        return { kind: 'hold', text: reviewStartedText({ reviewer, headSha: head.sha }) }
      }
    }
  })
}
