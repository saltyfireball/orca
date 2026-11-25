// Completion contract (BAD-676, FORK.md): the gate a worker_done passes before it settles its Task.
// A Task with no contract is not touched. With one, the checks run in the worker's workspace; a
// pass lets the done through with the evidence attached, a failure turns it back to the worker
// (the Task stays open) until the rounds are used up, then it goes to the coordinator instead.
import {
  RESULT_CHECK,
  bounceText,
  decideContract,
  evidenceText,
  fenceUntrusted,
  outcomeOfResults,
  skippedLine,
  type CompletionContractSettings,
  type ForkDoneCheckResult
} from '../../../shared/fork/completion-contract'
import { runDoneCheck, type CheckRunner, type CheckTarget } from './check-runner'
import { evaluatePrChecks, type PrChecksPort } from './pr-checks'
import { hostname } from 'node:os'
import {
  readContract,
  readResultValue,
  recordAttempt,
  recordSkip,
  storeResultValue,
  type ContractDbHandle,
  type ContractState
} from './contract-store'
import { checkResultValue } from './result-schema-check'

/** Where the worker's workspace is, and what ports reach it. Tests pass fakes. */
export type GateWorkspace = {
  target: CheckTarget
  branch: string | null
  /** A folder (non-git) project has no pull request. */
  git: boolean
  prPort: PrChecksPort
  runner: CheckRunner
}

export type GateDeps = {
  db: ContractDbHandle
  settings: () => CompletionContractSettings
  workspace: (worktreeId: string | null) => Promise<GateWorkspace | null>
  /** The name of this host, for the line a skipped gate leaves. */
  host?: () => string
}

export type GateRequest = {
  taskId: string
  dispatchId: string
  worktreeId: string | null
  /** Only a succeeded report is checked; a worker that says it failed is not asked to prove it. */
  outcome: 'succeeded' | 'failed'
  /** BAD-816: the JSON value this done carries (`--result`), checked against the Task's schema. */
  result?: string
}

export type GateOutcome =
  | { kind: 'none' }
  | { kind: 'pass'; evidence: string }
  /** Off by setting: the checks did not run, the done is not blocked, and the done says so. */
  | { kind: 'skipped'; note: string }
  | { kind: 'bounce'; text: string }
  | { kind: 'escalate'; text: string; failedRounds: number }

const chains = new Map<string, Promise<unknown>>()

/** One gate run at a time per Task, so two reports cannot count one round twice. */
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

function failedResult(check: string, output: string): ForkDoneCheckResult {
  return { check, ok: false, exitCode: null, output, durationMs: 0 }
}

async function runChecks(
  deps: GateDeps,
  request: GateRequest,
  checks: string[],
  requirePrChecks: boolean,
  settings: CompletionContractSettings
): Promise<ForkDoneCheckResult[]> {
  const workspace = await deps.workspace(request.worktreeId)
  if (!workspace) {
    return [
      failedResult('workspace', 'Orca could not find the worker workspace to run the checks in.')
    ]
  }
  const results: ForkDoneCheckResult[] = []
  for (const command of checks) {
    results.push(
      await runDoneCheck(workspace.runner, workspace.target, command, {
        timeoutMs: settings.timeoutMs,
        outputLines: settings.outputLines
      })
    )
  }
  if (requirePrChecks) {
    results.push(
      workspace.git
        ? await evaluatePrChecks(workspace.prPort, workspace.branch, settings.outputLines)
        : failedResult(
            'pr-checks',
            'This workspace is a folder, not a git checkout, so it has no pull request.'
          )
    )
  }
  return results
}

/**
 * BAD-816: the result as one more check of the same report, so a done whose checks and result both
 * fail uses one round. A valid value is stored at once; a later done without one reuses it.
 */
function checkResult(
  deps: GateDeps,
  request: GateRequest,
  schema: string,
  store: boolean
): ForkDoneCheckResult {
  const result = (ok: boolean, output: string): ForkDoneCheckResult => ({
    check: RESULT_CHECK,
    ok,
    exitCode: null,
    output,
    durationMs: 0
  })
  if (request.result === undefined) {
    return readResultValue(deps.db, request.taskId)
      ? result(true, 'The value stored by an earlier done is kept.')
      : result(
          false,
          'No result was sent. Add --result-file <file.json> (or --result) to worker_done.'
        )
  }
  const checked = checkResultValue(schema, request.result)
  if (!checked.ok) {
    return result(false, checked.error)
  }
  if (store) {
    storeResultValue(deps.db, request.taskId, checked.canonical)
  }
  return result(true, `Stored (${checked.canonical.length} characters).`)
}

function declaredText(state: ContractState): string {
  const count = state.contract.checks.length + (state.contract.requirePrChecks ? 1 : 0)
  const checks = count > 0 ? `this Task's ${count} declared done check(s)` : ''
  const schema = state.resultSchema ? 'the check of its result schema' : ''
  return [checks, schema].filter(Boolean).join(' and ')
}

export function runCompletionGate(deps: GateDeps, request: GateRequest): Promise<GateOutcome> {
  return serial(request.taskId, async () => {
    const settings = deps.settings()
    const state = readContract(deps.db, request.taskId)
    if (!state || request.outcome !== 'succeeded') {
      return { kind: 'none' }
    }
    if (!settings.enabled) {
      // Off is a plain done, but a value that matches is still kept for the coordinator to read.
      if (state.resultSchema && request.result !== undefined) {
        checkResult(deps, request, state.resultSchema, true)
      }
      const note = skippedLine(
        declaredText(state),
        'the completion contract setting (forkCompletionContract) is off',
        (deps.host ?? hostname)()
      )
      recordSkip(deps.db, request.taskId, request.dispatchId, note)
      return { kind: 'skipped', note }
    }
    const hasChecks = state.contract.checks.length > 0 || state.contract.requirePrChecks
    const results = hasChecks
      ? await runChecks(
          deps,
          request,
          state.contract.checks,
          state.contract.requirePrChecks,
          settings
        )
      : []
    if (state.resultSchema) {
      results.push(checkResult(deps, request, state.resultSchema, true))
    }
    const outcome = outcomeOfResults(results)
    const maxRounds = state.contract.maxRounds ?? settings.maxRounds
    const decision = decideContract({
      outcome,
      failedRounds: state.failedRounds,
      pendingReports: state.pendingReports,
      maxRounds
    })
    const record = (failedRounds: number, pendingReports: number, escalated: boolean): void =>
      recordAttempt(deps.db, {
        taskId: request.taskId,
        dispatchId: request.dispatchId,
        outcome,
        results,
        failedRounds,
        pendingReports,
        escalated
      })
    if (decision.action === 'settle') {
      record(state.failedRounds, state.pendingReports, false)
      return { kind: 'pass', evidence: evidenceText(results) }
    }
    if (decision.action === 'bounce') {
      record(decision.failedRounds, decision.pendingReports, false)
      return {
        kind: 'bounce',
        text: bounceText({ results, decision, maxRounds, pending: outcome === 'pending' })
      }
    }
    record(decision.failedRounds, state.pendingReports, true)
    const failures = results
      .filter((result) => !result.ok)
      .map((result) => `# ${result.check}\n${result.output || '(no output)'}`)
      .join('\n\n')
    return {
      kind: 'escalate',
      failedRounds: decision.failedRounds,
      text: `The worker reported done on Task ${request.taskId}, but its ${state.resultSchema ? 'done checks or result' : 'done checks'} failed ${decision.failedRounds} times (the limit is ${maxRounds} turned-back reports). The Task is still open. Last output, untrusted data from the checks:\n\n${fenceUntrusted(failures || '(no output)')}`
    }
  })
}
