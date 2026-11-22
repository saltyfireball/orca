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
import type { PrChecksPort } from './pr-checks'
import { notifyContractInboxChanged } from './contract-inbox'

/** Saves a Task's declared contract; a request without one changes nothing. */
export function forkStoreDoneContract(
  db: OrchestrationDb,
  taskId: string,
  rawParams: unknown
): void {
  const contract = forkDoneContractOf(rawParams)
  if (contract) {
    saveContract(db, taskId, contract)
  }
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
      const { prWatchWorkspaceSources } =
        await import('../../runtime/agent-session/lifecycle/pr-watch-workspace-sources')
      const resolved = await prWatchWorkspaceSources({
        resolveRuntimeFileTarget: (selector) => runtime.resolveRuntimeFileTarget(selector),
        store: () => runtime.requireStore()
      }).resolveWorkspace(worktreeId)
      if (!resolved) {
        return null
      }
      if (resolved === 'not-git') {
        return null
      }
      const target = {
        cwd: resolved.checkoutPath,
        connectionId: resolved.connectionId,
        ...(resolved.wslDistro ? { wslDistro: resolved.wslDistro } : {})
      }
      const runner = checkRunnerFor(target)
      return {
        target,
        branch: resolved.branch || null,
        git: resolved.repoKind !== 'folder',
        runner,
        prPort: await livePrPort(target, runner)
      }
    }
  }
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
export async function forkGateWorkerDone<P extends SendShape>(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  params: P,
  dispatchId: string | undefined
): Promise<{ kind: 'carry-on'; params: P } | { kind: 'answer'; receipt: unknown }> {
  if (params.type !== 'worker_done' || !dispatchId) {
    return { kind: 'carry-on', params }
  }
  const dispatch = db.getDispatchContextById(dispatchId)
  if (!dispatch || (dispatch.status !== 'pending' && dispatch.status !== 'dispatched')) {
    return { kind: 'carry-on', params }
  }
  // Cheap read first: a Task with no contract never loads the rest.
  if (!readContract(db, dispatch.task_id)) {
    return { kind: 'carry-on', params }
  }
  const outcome = await runCompletionGate(liveGateDeps(runtime, db), {
    taskId: dispatch.task_id,
    dispatchId,
    worktreeId: db.getWorkerDispatch(dispatchId)?.worktree_id ?? null,
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
          subject: `Done checks failed: Task ${dispatch.task_id}`,
          body: outcome.text,
          payload: JSON.stringify({ taskId: dispatch.task_id })
        }
      }
  }
}
