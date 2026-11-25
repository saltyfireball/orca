// Goal loop (BAD-822, FORK.md "Goal loop"): whether a goal's agent is an orchestration worker whose
// latest Dispatch it reported worker_done for, so its end is the worker's own and not a lost agent.
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { resolveStructuredWorkerIdentityForSession } from '../../runtime/orchestration/terminal-authority/structured-sessions/structured-worker-authority'
import { REPORT_OF } from '../worker-cleanup/worker-cleanup-query'

/** `id` is a terminal pane key or a chat session id. Reads only; false when nothing proves it. */
export function goalWorkerFinished(db: OrchestrationDb | null, id: string): boolean {
  if (!db) {
    return false
  }
  try {
    const handle = resolveStructuredWorkerIdentityForSession(id, db)?.handle ?? null
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the SELECT names exactly this column.
    const row = db.db
      .prepare(
        `SELECT EXISTS (SELECT 1 FROM messages m WHERE ${REPORT_OF('m')}) AS done
           FROM worker_terminal_resources r
          WHERE r.pane_key = ? OR r.terminal_handle = ?
          ORDER BY r.updated_at DESC LIMIT 1`
      )
      .get(id, handle ?? id) as { done?: number } | undefined
    return row?.done === 1
  } catch (error) {
    console.warn('[fork goal loop] could not read whether a worker finished', error)
    return false
  }
}
