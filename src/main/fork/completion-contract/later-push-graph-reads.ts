// Completion contract, later push (BAD-676, FORK.md): the reads of upstream's graph tables (Tasks,
// Dispatches, workers, paired-server Dispatches) the watch needs. Read only; nothing here writes them.
import type { ContractDbHandle } from './contract-store'
import { ensureWatchTable, type LaterPushWatch } from './later-push-store'

export type SettledPrTask = {
  taskId: string
  runId: string
  completedAtMs: number
  dispatchId: string | null
  worktreeId: string | null
  environmentId: string | null
  remoteWorktreeId: string | null
}

/** Graph rows hold ISO times or SQLite's `datetime('now')`, which is UTC without a zone. */
function timeMs(value: string | null): number {
  if (!value) {
    return 0
  }
  return (
    Date.parse(/[zZ]|[+-]\d\d:?\d\d$/u.test(value) ? value : `${value.replace(' ', 'T')}Z`) || 0
  )
}

/**
 * Completed Tasks that asked for pull request checks, settled since `sinceMs` and not yet watched,
 * with the Dispatch that settled them. Reads the upstream graph tables, never writes them.
 */
export function settledUnwatched(handle: ContractDbHandle, sinceMs: number): SettledPrTask[] {
  const db = ensureWatchTable(handle)
  const since = new Date(sinceMs).toISOString()
  const rows = db
    .prepare(
      `SELECT t.id AS taskId, t.run_id AS runId, t.completed_at AS completedAt,
              (SELECT d.id FROM dispatch_contexts d WHERE d.task_id = t.id AND d.status = 'completed'
                ORDER BY d.completed_at DESC, d.rowid DESC LIMIT 1) AS dispatchId
         FROM fork_done_contracts c JOIN tasks t ON t.id = c.task_id
        WHERE c.require_pr_checks = 1 AND t.status = 'completed' AND julianday(t.completed_at) >= julianday(?)
          AND NOT EXISTS (SELECT 1 FROM fork_done_watches w WHERE w.task_id = c.task_id)`
    )
    .all(since) as {
    taskId: string
    runId: string
    completedAt: string
    dispatchId: string | null
  }[]
  return rows.map((row) => {
    const where = row.dispatchId
      ? (db
          .prepare(
            `SELECT w.worktree_id AS worktreeId, f.environment_id AS environmentId,
                    f.remote_worktree_id AS remoteWorktreeId
               FROM dispatch_contexts d
               LEFT JOIN worker_dispatches w ON w.dispatch_id = d.id
               LEFT JOIN federated_dispatches f ON f.dispatch_id = d.id
              WHERE d.id = ?`
          )
          .get(row.dispatchId) as
          | {
              worktreeId: string | null
              environmentId: string | null
              remoteWorktreeId: string | null
            }
          | undefined)
      : undefined
    return {
      taskId: row.taskId,
      runId: row.runId,
      completedAtMs: timeMs(row.completedAt),
      dispatchId: row.dispatchId,
      worktreeId: where?.worktreeId ?? null,
      environmentId: where?.environmentId ?? null,
      remoteWorktreeId: where?.remoteWorktreeId ?? null
    }
  })
}

/** True while some Task asks for pull request checks and has neither settled nor failed: it may arm. */
export function hasOpenPrContracts(handle: ContractDbHandle): boolean {
  return (
    ensureWatchTable(handle)
      .prepare(
        `SELECT 1 FROM fork_done_contracts c LEFT JOIN tasks t ON t.id = c.task_id
          WHERE c.require_pr_checks = 1 AND COALESCE(t.status, '') != 'failed'
            AND NOT EXISTS (SELECT 1 FROM fork_done_watches w WHERE w.task_id = c.task_id)
          LIMIT 1`
      )
      .get() !== undefined
  )
}

/**
 * True when someone already works on the same pull request as a new Task: an open Dispatch that
 * continues the settled one (a follow-up or retry), or any open Dispatch in the same workspace.
 */
export function workspaceBusy(handle: ContractDbHandle, watch: LaterPushWatch): boolean {
  const remote = watch.environmentId !== null
  return (
    ensureWatchTable(handle)
      .prepare(
        `SELECT 1 FROM dispatch_contexts d
           LEFT JOIN worker_dispatches w ON w.dispatch_id = d.id
           LEFT JOIN federated_dispatches f ON f.dispatch_id = d.id
          WHERE d.status IN ('pending', 'dispatched') AND d.task_id != ?
            AND (d.follow_up_of_dispatch_id = ? OR d.retry_of_dispatch_id = ?
              OR (? = 0 AND ? IS NOT NULL AND w.worktree_id = ? AND f.dispatch_id IS NULL)
              OR (? = 1 AND f.environment_id = ? AND f.remote_worktree_id = ?))
          LIMIT 1`
      )
      .get(
        watch.taskId,
        watch.dispatchId,
        watch.dispatchId,
        remote ? 1 : 0,
        watch.worktreeId,
        watch.worktreeId,
        remote ? 1 : 0,
        watch.environmentId,
        watch.worktreeId
      ) !== undefined
  )
}
