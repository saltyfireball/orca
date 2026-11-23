// Completion contract (BAD-676, BAD-763): who a worker_done is gated for. A worker started on this
// host has a Dispatch; a worker a paired computer started here has only an attachment, and its
// done goes home as a relay. Both are read into one shape, so one gate serves both.
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { RemoteDispatchAttachmentRow } from '../../runtime/orchestration/db/orchestration-records'

export type GateSubject = {
  dispatchId: string
  taskId: string
  worktreeId: string | null
  /** Where a message to the worker goes: its chat session and/or its terminal pane. */
  sessionId: string | null
  paneKey: string | null
  /** The agent kind the worker runs, when this host knows it. */
  agent: string | null
}

function agentOfStartOptions(raw: string | undefined | null): string | null {
  try {
    const options: unknown = JSON.parse(raw ?? '{}')
    const agent = (options as { agent?: unknown } | null)?.agent
    return typeof agent === 'string' ? agent : null
  } catch {
    return null
  }
}

/** The open Dispatch of a worker on this host; null once it settled. */
export function subjectOfDispatch(
  db: OrchestrationDb,
  dispatchId: string | undefined
): GateSubject | null {
  if (!dispatchId) {
    return null
  }
  const dispatch = db.getDispatchContextById(dispatchId)
  if (!dispatch || (dispatch.status !== 'pending' && dispatch.status !== 'dispatched')) {
    return null
  }
  const worker = db.getWorkerDispatch(dispatchId)
  return {
    dispatchId,
    taskId: dispatch.task_id,
    worktreeId: worker?.worktree_id ?? null,
    sessionId: dispatch.assignee_orca_session_id ?? null,
    paneKey: dispatch.assignee_pane_key ?? null,
    agent: agentOfStartOptions(worker?.start_options)
  }
}

/** A worker a paired computer started on this host. */
export function subjectOfRemoteAttachment(
  attachment: Pick<
    RemoteDispatchAttachmentRow,
    'dispatch_id' | 'task_id' | 'worktree_id' | 'pane_key'
  >
): GateSubject {
  return {
    dispatchId: attachment.dispatch_id,
    taskId: attachment.task_id,
    worktreeId: attachment.worktree_id,
    sessionId: null,
    paneKey: attachment.pane_key,
    agent: null
  }
}
