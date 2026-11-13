// Worker cleanup (FORK.md): the finished workers that may be cleaned up, read straight from the
// orchestration database with the facts each guard needs. Reads only; nothing here writes.
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import {
  exposeUtcTimestamp,
  toSqliteUtcTimestamp
} from '../../runtime/orchestration/db/utc-timestamp'

export type WorkerCleanupCandidate = {
  resourceId: string
  dispatchId: string
  paneKey: string | null
  terminalHandle: string
  worktreeId: string | null
  /** When the worker last reported done (ms), or when its dispatch settled if no report is found. */
  doneAtMs: number
  /** The coordinator has not read a done report yet. */
  unreadReport: boolean
  /** A question to the user or an approval is still open. */
  pendingQuestion: boolean
}

// A worker_done names its dispatch by sender or by payload; a bad payload must not fail the query.
const REPORT_OF = (alias: string): string => `${alias}.type = 'worker_done' AND (
  ${alias}.from_handle = 'dispatch:' || r.owner_dispatch_id
  OR (CASE WHEN json_valid(${alias}.payload)
      THEN json_extract(${alias}.payload, '$.dispatchId') END) = r.owner_dispatch_id
)`

type Row = {
  resource_id: string
  dispatch_id: string
  pane_key: string | null
  terminal_handle: string
  worktree_id: string | null
  done_at: string | null
  settled_at: string
  unread_report: number
  pending_question: number
}

/**
 * Owned, not yet kept or released resources whose dispatch finished with a report (succeeded or
 * failed). A worker stopped, abandoned or still running is never a candidate, and neither is one
 * whose report is older than `sinceMs` (the turn record that proves it unused only covers this run).
 */
export function listWorkerCleanupCandidates(
  db: OrchestrationDb,
  sinceMs: number
): WorkerCleanupCandidate[] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the SELECT names exactly these columns.
  const rows = db.db
    .prepare(
      `SELECT r.id AS resource_id, r.owner_dispatch_id AS dispatch_id, r.pane_key,
              r.terminal_handle, r.worktree_id, w.updated_at AS settled_at,
              (SELECT MAX(m.created_at) FROM messages m WHERE ${REPORT_OF('m')}) AS done_at,
              EXISTS (SELECT 1 FROM messages m WHERE ${REPORT_OF('m')} AND m.read = 0)
                AS unread_report,
              (EXISTS (
                 SELECT 1 FROM question_threads q
                  WHERE q.dispatch_id = r.owner_dispatch_id AND q.status = 'pending'
               ) OR EXISTS (
                 SELECT 1 FROM decision_gates g
                   JOIN dispatch_contexts d ON d.task_id = g.task_id
                  WHERE d.id = r.owner_dispatch_id AND g.status = 'pending'
               )) AS pending_question
         FROM worker_terminal_resources r
         JOIN worker_dispatches w ON w.dispatch_id = r.owner_dispatch_id
        WHERE r.ownership_state = 'owned' AND r.release_state = 'not_requested'
          AND w.state IN ('succeeded', 'failed')`
    )
    .all() as Row[]
  const since = toSqliteUtcTimestamp(sinceMs)
  return rows.flatMap((row) => {
    const done = row.done_at ?? row.settled_at
    if (done < since) {
      return []
    }
    const doneAtMs = Date.parse(exposeUtcTimestamp(done) ?? done)
    if (!Number.isFinite(doneAtMs)) {
      return []
    }
    return [
      {
        resourceId: row.resource_id,
        dispatchId: row.dispatch_id,
        paneKey: row.pane_key,
        terminalHandle: row.terminal_handle,
        worktreeId: row.worktree_id,
        doneAtMs,
        unreadReport: row.unread_report === 1,
        pendingQuestion: row.pending_question === 1
      }
    ]
  })
}

/**
 * Hand one candidate to the stock release path: requested now, with the automatic-close markers
 * set so the stock path still yields to an agent that starts working again before it closes.
 * Returns false when the row moved on (kept, released or reused) since it was read.
 */
export function claimWorkerCleanupRelease(
  db: OrchestrationDb,
  resourceId: string,
  nowMs: number
): boolean {
  const { changes } = db.db
    .prepare(
      `UPDATE worker_terminal_resources
          SET release_state = 'requested', retained_reason = NULL,
              release_requested_at = datetime('now'), release_error = NULL,
              auto_release_at = ?, auto_release_dispatch_id = owner_dispatch_id,
              updated_at = datetime('now')
        WHERE id = ? AND ownership_state = 'owned' AND release_state = 'not_requested'`
    )
    .run(toSqliteUtcTimestamp(nowMs), resourceId)
  return changes > 0
}
