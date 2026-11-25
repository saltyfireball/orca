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
  reviewerAgentFor,
  type ReviewerGateSettings
} from '../../../shared/fork/reviewer-gate'
import type { GateDeps } from '../completion-contract/completion-gate'
import type { GateSubject } from '../completion-contract/gate-subject'
import { sendIdleRecoveryAnswer } from '../idle-recovery/idle-recovery-wake'
import { runReviewGate, type ReviewGateDeps } from './reviewer-gate'
import { readReviewGate, saveReviewGate } from './reviewer-store'

export function forkStoreReviewGate(db: OrchestrationDb, taskId: string, rawParams: unknown): void {
  const gate = forkReviewGateOf(rawParams)
  if (gate) {
    saveReviewGate(db, taskId, gate)
  }
}

/**
 * BAD-798: a worker a paired computer attached here has no recorded agent at its done, which would
 * pick Codex even for a Codex worker. A review that names no reviewer is pinned now, while the
 * agent it starts is known, to the other provider.
 */
export function forkPinAttachedReviewer(
  db: OrchestrationDb,
  taskId: string,
  workerAgent: string | null | undefined
): void {
  const found = readReviewGate(db, taskId)
  if (!workerAgent || !found || found.implicit || found.gate.agent) {
    return
  }
  saveReviewGate(db, taskId, { ...found.gate, agent: reviewerAgentFor(workerAgent, null) })
}

export function forkReviewerGateSettings(runtime: OrcaRuntimeService): ReviewerGateSettings {
  // Before the store attaches the defaults apply; a worker_done must not fail on it.
  let settings: unknown = null
  try {
    settings = runtime.requireStore().getSettings()
  } catch {
    settings = null
  }
  return readReviewerGateSettings(settings as never)
}

/** A message into the worker's own chat (or terminal), the way a person's message is sent. */
async function deliverToWorker(subject: GateSubject, text: string): Promise<boolean> {
  const agent = subject.agent ?? ''
  if (subject.sessionId) {
    const outcome = await sendIdleRecoveryAnswer(subject.sessionId, text, { kind: 'chat', agent })
    if (outcome === 'sent') {
      return true
    }
  }
  if (subject.paneKey) {
    return (
      (await sendIdleRecoveryAnswer(subject.paneKey, text, { kind: 'terminal', agent })) === 'sent'
    )
  }
  return false
}

function liveReviewDeps(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  workspaceOf: GateDeps['workspace'],
  subject: GateSubject
): ReviewGateDeps {
  return {
    db,
    settings: () => forkReviewerGateSettings(runtime),
    workspace: async (worktreeId) => {
      const workspace = await workspaceOf(worktreeId)
      return workspace
        ? { target: workspace.target, git: workspace.git, runner: workspace.runner }
        : null
    },
    workerAgent: () => subject.agent,
    deliver: (_dispatchId, text) => deliverToWorker(subject, text)
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
  subject: GateSubject | null,
  workspaceOf: GateDeps['workspace']
): Promise<{ kind: 'carry-on'; params: P } | { kind: 'answer'; receipt: unknown }> {
  if (params.type !== 'worker_done' || !subject) {
    return { kind: 'carry-on', params }
  }
  // Cheap read first: with no request and no all-Tasks setting nothing else loads.
  if (!readReviewGate(db, subject.taskId) && !forkReviewerGateSettings(runtime).allTasks) {
    return { kind: 'carry-on', params }
  }
  const outcome = await runReviewGate(liveReviewDeps(runtime, db, workspaceOf, subject), {
    taskId: subject.taskId,
    dispatchId: subject.dispatchId,
    worktreeId: subject.worktreeId,
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
    case 'skipped':
      return {
        kind: 'carry-on',
        params: { ...params, body: [params.body, outcome.note].filter(Boolean).join('\n\n') }
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
          subject: `Review gate: Task ${subject.taskId}`,
          body: outcome.text,
          payload: JSON.stringify({ taskId: subject.taskId })
        }
      }
  }
}
