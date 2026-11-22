// Reviewer gate (BAD-683, FORK.md): the live wiring.
// - `forkStoreReviewGate(db, taskId, rawParams)`: from taskCreate and worker-start, saves the review
//   the request asked for (nothing when it asked for none).
// - `forkReviewWorkerDone(...)`: called after the completion contract passed, before a worker_done
//   is stored. It returns a receipt to answer with (the report is held or turned back), the params
//   to carry on with, or an escalation. A Task that asks for no review is returned as is.
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import {
  forkReviewGateOf,
  readReviewerGateSettings,
  type ReviewerGateSettings
} from '../../../shared/fork/reviewer-gate'
import type { GateDeps } from '../completion-contract/completion-gate'
import { sendIdleRecoveryAnswer } from '../idle-recovery/idle-recovery-wake'
import { runReviewGate, type ReviewGateDeps } from './reviewer-gate'
import { readReviewGate, saveReviewGate } from './reviewer-store'

export function forkStoreReviewGate(db: OrchestrationDb, taskId: string, rawParams: unknown): void {
  const gate = forkReviewGateOf(rawParams)
  if (gate) {
    saveReviewGate(db, taskId, gate)
  }
}

function settingsOf(runtime: OrcaRuntimeService): ReviewerGateSettings {
  // Before the store attaches the defaults apply; a worker_done must not fail on it.
  let settings: unknown = null
  try {
    settings = runtime.requireStore().getSettings()
  } catch {
    settings = null
  }
  return readReviewerGateSettings(settings as never)
}

function workerAgentOf(db: OrchestrationDb, dispatchId: string): string | null {
  try {
    const options: unknown = JSON.parse(db.getWorkerDispatch(dispatchId)?.start_options ?? '{}')
    const agent = (options as { agent?: unknown } | null)?.agent
    return typeof agent === 'string' ? agent : null
  } catch {
    return null
  }
}

/** A message into the worker's own chat (or terminal), the way a person's message is sent. */
async function deliverToWorker(
  db: OrchestrationDb,
  dispatchId: string,
  text: string
): Promise<boolean> {
  const dispatch = db.getDispatchContextById(dispatchId)
  if (!dispatch) {
    return false
  }
  const agent = workerAgentOf(db, dispatchId) ?? ''
  if (dispatch.assignee_orca_session_id) {
    const outcome = await sendIdleRecoveryAnswer(dispatch.assignee_orca_session_id, text, {
      kind: 'chat',
      agent
    })
    if (outcome === 'sent') {
      return true
    }
  }
  if (dispatch.assignee_pane_key) {
    return (
      (await sendIdleRecoveryAnswer(dispatch.assignee_pane_key, text, {
        kind: 'terminal',
        agent
      })) === 'sent'
    )
  }
  return false
}

function liveReviewDeps(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  workspaceOf: GateDeps['workspace']
): ReviewGateDeps {
  return {
    db,
    settings: () => settingsOf(runtime),
    workspace: async (worktreeId) => {
      const workspace = await workspaceOf(worktreeId)
      return workspace
        ? { target: workspace.target, git: workspace.git, runner: workspace.runner }
        : null
    },
    workerAgent: (dispatchId) => workerAgentOf(db, dispatchId),
    deliver: (dispatchId, text) => deliverToWorker(db, dispatchId, text)
  }
}

type SendShape = {
  type?: string
  subject: string
  body?: string
  payload?: string
  [key: string]: unknown
}

function workerSucceeded(payload: string | undefined): boolean {
  try {
    const parsed: unknown = JSON.parse(payload ?? '{}')
    return !(
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { outcome?: unknown }).outcome === 'failed'
    )
  } catch {
    return true
  }
}

export async function forkReviewWorkerDone<P extends SendShape>(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  params: P,
  dispatchId: string | undefined,
  workspaceOf: GateDeps['workspace']
): Promise<{ kind: 'carry-on'; params: P } | { kind: 'answer'; receipt: unknown }> {
  if (params.type !== 'worker_done' || !dispatchId) {
    return { kind: 'carry-on', params }
  }
  const dispatch = db.getDispatchContextById(dispatchId)
  if (!dispatch || (dispatch.status !== 'pending' && dispatch.status !== 'dispatched')) {
    return { kind: 'carry-on', params }
  }
  // Cheap read first: with no request and no all-Tasks setting nothing else loads.
  if (!readReviewGate(db, dispatch.task_id) && !settingsOf(runtime).allTasks) {
    return { kind: 'carry-on', params }
  }
  const outcome = await runReviewGate(liveReviewDeps(runtime, db, workspaceOf), {
    taskId: dispatch.task_id,
    dispatchId,
    worktreeId: db.getWorkerDispatch(dispatchId)?.worktree_id ?? null,
    outcome: workerSucceeded(params.payload) ? 'succeeded' : 'failed'
  })
  switch (outcome.kind) {
    case 'none':
      return { kind: 'carry-on', params }
    case 'pass':
      return {
        kind: 'carry-on',
        params: { ...params, body: [params.body, outcome.evidence].filter(Boolean).join('\n\n') }
      }
    case 'hold':
      return {
        kind: 'answer',
        receipt: {
          lifecycle: { action: 'rejected', code: 'review_pending', reason: outcome.text }
        }
      }
    case 'escalate':
      return {
        kind: 'carry-on',
        params: {
          ...params,
          type: 'escalation',
          subject: `Review gate: Task ${dispatch.task_id}`,
          body: outcome.text,
          payload: JSON.stringify({ taskId: dispatch.task_id })
        }
      }
  }
}
