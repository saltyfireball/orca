// Completion contract (BAD-676, FORK.md): the live wiring and the hooks upstream files call.
// - `forkStoreDoneContract(db, taskId, rawParams)`: from taskCreate and worker-start, saves the
//   contract the request declared (nothing when it declared none).
// - `forkGateWorkerDone(...)`: from the `orchestration.send` handler, before a worker_done is
//   stored. It returns a receipt to answer with (the done was turned back or sent on as an
//   escalation), or the params to carry on with. Without a contract it returns the params as is.
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import {
  forkDoneContractOf,
  readCompletionContractSettings,
  type CompletionContractSettings
} from '../../../shared/fork/completion-contract'
import { saveContract, readContract } from './contract-store'
import { runCompletionGate, type GateDeps, type GateWorkspace } from './completion-gate'
import { checkRunnerFor } from './check-runner'
import { resolveGateWorkspace } from './gate-workspace'
import type { PrChecksPort } from './pr-checks'
import { notifyContractInboxChanged } from './contract-inbox'
import { forkReviewWorkerDone, forkStoreReviewGate } from '../reviewer-gate/reviewer-gate-live'
import { forkCarryContract } from './contract-carry'
import { currentForkAgentProfileLaunch } from '../agent-profiles/agent-profile-launch-scope'
import { forkStoreTaskProfilePreamble } from '../agent-profiles/agent-profile-task-store'
import { subjectOfDispatch, subjectOfRemoteAttachment, type GateSubject } from './gate-subject'
import type { RemoteDispatchAttachmentRow } from '../../runtime/orchestration/db/orchestration-records'

/** The Dispatch a `worker-start --retry-of` names. */
function retryOfOf(rawParams: unknown): string | undefined {
  const retryOf = (rawParams as { retryOf?: unknown } | null)?.retryOf
  return typeof retryOf === 'string' ? retryOf : undefined
}

/**
 * Saves a Task's declared contract; a request without one changes nothing. `continuesDispatchId`
 * (BAD-763) names the Dispatch a retry or follow-up continues: its Task's contract and review
 * request come across when this request declares none of its own.
 */
export function forkStoreDoneContract(
  db: OrchestrationDb,
  taskId: string,
  rawParams: unknown,
  continuesDispatchId?: string
): void {
  const contract = forkDoneContractOf(rawParams)
  if (contract) {
    saveContract(db, taskId, contract)
  }
  // BAD-683: a review the request asked for rides the same hook.
  forkStoreReviewGate(db, taskId, rawParams)
  forkCarryContract(db, taskId, continuesDispatchId ?? retryOfOf(rawParams))
  // BAD-741: the --profile preamble follows the Task the same way.
  const launch = currentForkAgentProfileLaunch()
  forkStoreTaskProfilePreamble(
    db,
    taskId,
    launch && { profile: launch.name, preamble: launch.preamble },
    continuesDispatchId ?? retryOfOf(rawParams)
  )
}

function settingsOf(runtime: OrcaRuntimeService): CompletionContractSettings {
  return readCompletionContractSettings(runtime.requireStore().getSettings() as never)
}

/** gh and git in the workspace, on the host it lives on. */
async function livePrPort(
  target: GateWorkspace['target'],
  runner: GateWorkspace['runner']
): Promise<PrChecksPort> {
  if (target.connectionId) {
    // Through the same SSH channel as the checks: the remote host's own gh and its login.
    const run = async (command: string): Promise<string> => {
      const raw = await runner(target, command, 60_000)
      if (raw.exitCode !== 0) {
        throw Object.assign(new Error(raw.output.trim() || 'command failed'), {
          stdout: raw.output
        })
      }
      return raw.output
    }
    const quote = (args: string[]): string =>
      args.map((arg) => `'${arg.replace(/'/gu, `'\\''`)}'`).join(' ')
    return {
      gh: (args) => run(`gh ${quote(args)}`),
      git: (args) => run(`git ${quote(args)}`)
    }
  }
  const [{ ghExecFileAsync }, { gitExecFileAsync }] = await Promise.all([
    import('../../git/command-runner/hosted-cli/gh-exec-file'),
    import('../../git/command-runner/git-exec-file')
  ])
  const wsl = target.wslDistro ? { wslDistro: target.wslDistro } : {}
  return {
    gh: async (args) =>
      (
        await ghExecFileAsync(args, {
          cwd: target.cwd,
          ...wsl,
          env: { ...process.env, GH_PROMPT_DISABLED: '1' }
        })
      ).stdout,
    git: async (args) => (await gitExecFileAsync(args, { cwd: target.cwd, ...wsl })).stdout
  }
}

function liveGateDeps(runtime: OrcaRuntimeService, db: OrchestrationDb): GateDeps {
  return {
    db,
    settings: () => settingsOf(runtime),
    workspace: async (worktreeId) => {
      if (!worktreeId) {
        return null
      }
      const resolved = await resolveGateWorkspace(
        {
          resolveRuntimeFileTarget: (selector) => runtime.resolveRuntimeFileTarget(selector),
          store: () => runtime.requireStore()
        },
        worktreeId
      )
      if (!resolved) {
        return null
      }
      const { target } = resolved
      const runner = checkRunnerFor(target)
      return {
        target,
        branch: resolved.branch,
        git: resolved.git,
        runner,
        prPort: await livePrPort(target, runner)
      }
    }
  }
}

/** The worker workspace a check or a later-push read runs in, on the host it lives on. */
export function liveGateWorkspace(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb
): GateDeps['workspace'] {
  return liveGateDeps(runtime, db).workspace
}

type SendShape = {
  type?: string
  subject: string
  body?: string
  payload?: string
  [key: string]: unknown
}

function workerOutcomeOf(payload: string | undefined): 'succeeded' | 'failed' {
  try {
    const parsed: unknown = JSON.parse(payload ?? '{}')
    return typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { outcome?: unknown }).outcome === 'failed'
      ? 'failed'
      : 'succeeded'
  } catch {
    return 'succeeded'
  }
}

/**
 * Runs the Task's done checks for a worker_done. `answer` carries the receipt for a done that was
 * turned back; an escalation changes the message into an `escalation` so the Task is not settled.
 */
async function gateByContract<P extends SendShape>(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  params: P,
  subject: GateSubject | null
): Promise<{ kind: 'carry-on'; params: P } | { kind: 'answer'; receipt: unknown }> {
  if (params.type !== 'worker_done' || !subject) {
    return { kind: 'carry-on', params }
  }
  // Cheap read first: a Task with no contract never loads the rest.
  if (!readContract(db, subject.taskId)) {
    return { kind: 'carry-on', params }
  }
  const outcome = await runCompletionGate(liveGateDeps(runtime, db), {
    taskId: subject.taskId,
    dispatchId: subject.dispatchId,
    worktreeId: subject.worktreeId,
    outcome: workerOutcomeOf(params.payload)
  })
  switch (outcome.kind) {
    case 'none':
      return { kind: 'carry-on', params }
    case 'pass':
      return {
        kind: 'carry-on',
        params: { ...params, body: [params.body, outcome.evidence].filter(Boolean).join('\n\n') }
      }
    case 'skipped':
      return {
        kind: 'carry-on',
        params: { ...params, body: [params.body, outcome.note].filter(Boolean).join('\n\n') }
      }
    case 'bounce':
      return {
        kind: 'answer',
        receipt: {
          lifecycle: { action: 'rejected', code: 'done_checks_failed', reason: outcome.text }
        }
      }
    case 'escalate':
      notifyContractInboxChanged()
      return {
        kind: 'carry-on',
        params: {
          ...params,
          type: 'escalation',
          subject: `Done checks failed: Task ${subject.taskId}`,
          body: outcome.text,
          payload: JSON.stringify({ taskId: subject.taskId })
        }
      }
  }
}

/**
 * The two gates a worker_done passes, in order: the done checks, then the reviewer (BAD-683),
 * so a second agent is never asked to review work whose own checks fail.
 */
async function gateSubject<P extends SendShape>(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  params: P,
  subject: GateSubject | null
): Promise<{ kind: 'carry-on'; params: P } | { kind: 'answer'; receipt: unknown }> {
  const contract = await gateByContract(runtime, db, params, subject)
  if (contract.kind === 'answer' || contract.params.type !== 'worker_done') {
    return contract
  }
  return forkReviewWorkerDone(
    runtime,
    db,
    contract.params,
    subject,
    liveGateDeps(runtime, db).workspace
  )
}

export function forkGateWorkerDone<P extends SendShape>(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  params: P,
  dispatchId: string | undefined
): Promise<{ kind: 'carry-on'; params: P } | { kind: 'answer'; receipt: unknown }> {
  return gateSubject(runtime, db, params, subjectOfDispatch(db, dispatchId))
}

/**
 * BAD-763: the same gates for a worker a paired computer started on this host. Its done goes home
 * as a relay, so the checks run here, in the workspace they are about, before the report is
 * queued: a failure answers the worker and nothing reaches the Run home.
 */
export function forkGateRemoteWorkerDone<P extends SendShape>(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  params: P,
  attachment: Pick<
    RemoteDispatchAttachmentRow,
    'dispatch_id' | 'task_id' | 'worktree_id' | 'pane_key'
  >
): Promise<{ kind: 'carry-on'; params: P } | { kind: 'answer'; receipt: unknown }> {
  return gateSubject(runtime, db, params, subjectOfRemoteAttachment(attachment))
}
