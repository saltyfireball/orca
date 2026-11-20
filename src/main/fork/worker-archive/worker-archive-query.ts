// Worker archive (FORK.md, BAD-669): every dispatch that used a workspace a worker start created,
// read from the orchestration database. Reads only. A workspace is "the worker's" only when
// listWorkerCreatedWorktrees proves a new-child or new-top-level start made it; a workspace a
// worker merely ran in (`workspace: current`, an id) never shows up here.
import type { WorkerWorkspaceDispatchFacts } from '../../../shared/fork/worker-archive'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { exposeUtcTimestamp } from '../../runtime/orchestration/db/utc-timestamp'
import {
  listWorkerCreatedWorktrees,
  type WorkerCreatedWorktree
} from '../../runtime/orchestration/db/worker-dispatch/worker-created-worktrees'

export type WorkerWorkspaceDispatch = WorkerWorkspaceDispatchFacts & {
  dispatchId: string
  paneKey: string | null
  terminalHandle: string | null
  /** The chat or pane that started the worker, for naming its bot. */
  creatorSessionId: string | null
  creatorPaneKey: string | null
}

export type WorkerWorkspaceRecord = {
  worktreeId: string
  created: WorkerCreatedWorktree
  dispatches: WorkerWorkspaceDispatch[]
}

type Row = {
  dispatch_id: string
  state: string
  worktree_id: string
  settled_at: string
  done_at: string | null
  pane_key: string | null
  terminal_handle: string | null
  ownership_state: string | null
  release_state: string | null
  retained_reason: string | null
  creator_session: string | null
  creator_pane: string | null
}

// A worker_done names its dispatch by sender or by payload; a bad payload must not fail the query.
const DONE_AT = `(SELECT MAX(m.created_at) FROM messages m
   WHERE m.type = 'worker_done' AND (
     m.from_handle = 'dispatch:' || u.dispatch_id
     OR (CASE WHEN json_valid(m.payload)
         THEN json_extract(m.payload, '$.dispatchId') END) = u.dispatch_id))`

function ms(value: string | null): number {
  const parsed = value ? Date.parse(exposeUtcTimestamp(value) ?? value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Keep open is `release_state = 'retained'` with reason `user_kept`; a terminal the user took over
 * or handed on is held too. A released, requested or never-armed terminal is not a hold.
 */
function toFacts(row: Row): WorkerWorkspaceDispatch {
  return {
    dispatchId: row.dispatch_id,
    state: row.state,
    finishedAtMs: ms(row.done_at ?? row.settled_at),
    keptOpen: row.release_state === 'retained' && row.retained_reason === 'user_kept',
    takenOver:
      row.ownership_state !== null &&
      row.ownership_state !== 'owned' &&
      row.ownership_state !== 'released',
    paneKey: row.pane_key,
    terminalHandle: row.terminal_handle,
    creatorSessionId: row.creator_session,
    creatorPaneKey: row.creator_pane
  }
}

/** The workspaces worker starts created on this host, each with every dispatch that used it. */
export function listWorkerWorkspaceRecords(db: OrchestrationDb): WorkerWorkspaceRecord[] {
  const created = listWorkerCreatedWorktrees(db)
  if (created.size === 0) {
    return []
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the SELECT names exactly these columns.
  const rows = db.db
    .prepare(
      `SELECT u.dispatch_id, u.state, u.worktree_id, u.settled_at, ${DONE_AT} AS done_at,
              r.pane_key, COALESCE(r.terminal_handle, u.terminal_handle) AS terminal_handle,
              r.ownership_state, r.release_state, r.retained_reason,
              c.creator_orca_session_id AS creator_session, c.creator_pane_key AS creator_pane
         FROM (
           SELECT dispatch_id, state, updated_at AS settled_at, agent_terminal_handle AS terminal_handle,
                  COALESCE(worktree_id, CASE WHEN json_valid(start_options)
                    THEN json_extract(start_options, '$.resolvedWorktreeId') END) AS worktree_id
             FROM worker_dispatches
           UNION ALL
           SELECT dispatch_id, state, updated_at, terminal_handle, worktree_id
             FROM remote_dispatch_attachments
         ) u
         LEFT JOIN worker_terminal_resources r ON r.owner_dispatch_id = u.dispatch_id
         LEFT JOIN dispatch_contexts c ON c.id = u.dispatch_id
        WHERE u.worktree_id IS NOT NULL`
    )
    .all() as Row[]
  const byWorktree = new Map<string, WorkerWorkspaceDispatch[]>()
  for (const row of rows) {
    if (created.has(row.worktree_id)) {
      const list = byWorktree.get(row.worktree_id) ?? []
      list.push(toFacts(row))
      byWorktree.set(row.worktree_id, list)
    }
  }
  return [...byWorktree].flatMap(([worktreeId, dispatches]) => {
    const info = created.get(worktreeId)
    return info ? [{ worktreeId, created: info, dispatches }] : []
  })
}
