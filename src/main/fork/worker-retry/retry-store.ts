// Worker retry policy (BAD-681, FORK.md): each Run's own policy and every restart, in two
// fork-owned tables of the orchestration database. Created on first use, so upstream's schema and
// its version stay untouched. Rows are keyed by Run and Task id and never read by upstream.
import type Database from '../../sqlite/sync-database'
import type { ForkWorkerRetryEntry, WorkerRetryRunPolicy } from '../../../shared/fork/worker-retry'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { scopedCrewChange } from '../../runtime/orchestration/crew/crew-changes'

export type RetryDbHandle = { db: Database.Database }

/** The crew view shows each retry on its worker's row: a changed retry rebuilds those rows. */
function crewChanged(handle: RetryDbHandle, dispatchIds: (string | null | undefined)[]): void {
  const changes = (handle as Partial<Pick<OrchestrationDb, 'crewChanges'>>).crewChanges
  const ids = dispatchIds.filter((id): id is string => typeof id === 'string')
  if (changes && ids.length > 0) {
    changes.notify(scopedCrewChange(['assignments'], { dispatchIds: new Set(ids) }))
  }
}

const ready = new WeakSet<Database.Database>()

function ensureTables(handle: RetryDbHandle): Database.Database {
  const { db } = handle
  if (!ready.has(db)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS fork_run_retry_policy (
        run_id TEXT PRIMARY KEY,
        enabled INTEGER,
        max_attempts INTEGER,
        backoff_seconds INTEGER
      );
      CREATE TABLE IF NOT EXISTS fork_worker_retries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        run_id TEXT,
        dispatch_id TEXT NOT NULL,
        retry_dispatch_id TEXT,
        attempt INTEGER NOT NULL,
        reason TEXT NOT NULL,
        at TEXT NOT NULL DEFAULT (datetime('now')),
        due_at TEXT NOT NULL,
        status TEXT NOT NULL,
        detail TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS fork_worker_retries_dispatch
        ON fork_worker_retries (dispatch_id);
      CREATE INDEX IF NOT EXISTS fork_worker_retries_task ON fork_worker_retries (task_id, id);
      CREATE INDEX IF NOT EXISTS fork_worker_retries_restart
        ON fork_worker_retries (retry_dispatch_id);
    `)
    ready.add(db)
  }
  return db
}

type PolicyRow = {
  enabled: number | null
  max_attempts: number | null
  backoff_seconds: number | null
}

export function readRunPolicy(handle: RetryDbHandle, runId: string): WorkerRetryRunPolicy | null {
  const row = ensureTables(handle)
    .prepare(
      'SELECT enabled, max_attempts, backoff_seconds FROM fork_run_retry_policy WHERE run_id = ?'
    )
    .get(runId) as PolicyRow | undefined
  return row
    ? {
        enabled: row.enabled === null ? null : row.enabled === 1,
        max: row.max_attempts,
        backoffSeconds: row.backoff_seconds
      }
    : null
}

export function writeRunPolicy(
  handle: RetryDbHandle,
  runId: string,
  patch: Partial<WorkerRetryRunPolicy>
): WorkerRetryRunPolicy {
  const current = readRunPolicy(handle, runId) ?? {
    enabled: null,
    max: null,
    backoffSeconds: null
  }
  const next = { ...current, ...patch }
  ensureTables(handle)
    .prepare(
      `INSERT INTO fork_run_retry_policy (run_id, enabled, max_attempts, backoff_seconds)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET enabled = excluded.enabled,
         max_attempts = excluded.max_attempts, backoff_seconds = excluded.backoff_seconds`
    )
    .run(runId, next.enabled === null ? null : next.enabled ? 1 : 0, next.max, next.backoffSeconds)
  return next
}

export function clearRunPolicy(handle: RetryDbHandle, runId: string): void {
  ensureTables(handle).prepare('DELETE FROM fork_run_retry_policy WHERE run_id = ?').run(runId)
}

/** Restarts already behind a Dispatch: each restart is a new Dispatch with its own Task, so the
 *  count walks back through the restarts that started it. */
export function countRetryChain(handle: RetryDbHandle, dispatchId: string): number {
  const db = ensureTables(handle)
  const seen = new Set<string>()
  let count = 0
  for (let current = dispatchId; !seen.has(current);) {
    seen.add(current)
    const prior = db
      .prepare(
        "SELECT dispatch_id FROM fork_worker_retries WHERE retry_dispatch_id = ? AND status = 'started'"
      )
      .get(current) as { dispatch_id: string } | undefined
    if (!prior) {
      break
    }
    count += 1
    current = prior.dispatch_id
  }
  return count
}

export function readRetryOf(
  handle: RetryDbHandle,
  dispatchId: string
): ForkWorkerRetryEntry | null {
  const row = ensureTables(handle)
    .prepare(
      `SELECT task_id, run_id, dispatch_id, retry_dispatch_id, attempt, reason, at, due_at, status, detail
       FROM fork_worker_retries WHERE dispatch_id = ?`
    )
    .get(dispatchId) as EntryRow | undefined
  return row ? entryOf(row) : null
}

/** Records a scheduled restart. False when this Dispatch already has one (a report seen twice). */
export function recordRetry(
  handle: RetryDbHandle,
  entry: {
    taskId: string
    runId: string | null
    dispatchId: string
    attempt: number
    reason: string
    dueAtMs: number
  }
): boolean {
  const result = ensureTables(handle)
    .prepare(
      `INSERT OR IGNORE INTO fork_worker_retries
         (task_id, run_id, dispatch_id, attempt, reason, due_at, status)
       VALUES (?, ?, ?, ?, ?, ?, 'scheduled')`
    )
    .run(
      entry.taskId,
      entry.runId,
      entry.dispatchId,
      entry.attempt,
      entry.reason,
      new Date(entry.dueAtMs).toISOString()
    )
  crewChanged(handle, [entry.dispatchId])
  return result.changes > 0
}

/** Records a failure the policy left to the coordinator, with why, for `orca retry show`. */
export function recordSkippedRetry(
  handle: RetryDbHandle,
  entry: {
    taskId: string
    runId: string | null
    dispatchId: string
    attempt: number
    reason: string
    detail: string
  }
): void {
  ensureTables(handle)
    .prepare(
      `INSERT OR IGNORE INTO fork_worker_retries
         (task_id, run_id, dispatch_id, attempt, reason, due_at, status, detail)
       VALUES (?, ?, ?, ?, ?, ?, 'skipped', ?)`
    )
    .run(
      entry.taskId,
      entry.runId,
      entry.dispatchId,
      entry.attempt,
      entry.reason,
      new Date().toISOString(),
      entry.detail.slice(0, 500)
    )
  crewChanged(handle, [entry.dispatchId])
}

export function settleRetry(
  handle: RetryDbHandle,
  dispatchId: string,
  status: 'started' | 'failed' | 'cancelled',
  patch: { retryDispatchId?: string | null; detail?: string | null } = {}
): void {
  ensureTables(handle)
    .prepare(
      `UPDATE fork_worker_retries SET status = ?, retry_dispatch_id = COALESCE(?, retry_dispatch_id),
         detail = ? WHERE dispatch_id = ?`
    )
    .run(status, patch.retryDispatchId ?? null, patch.detail?.slice(0, 500) ?? null, dispatchId)
  crewChanged(handle, [dispatchId, patch.retryDispatchId])
}

type EntryRow = {
  task_id: string
  run_id: string | null
  dispatch_id: string
  retry_dispatch_id: string | null
  attempt: number
  reason: string
  at: string
  due_at: string
  status: ForkWorkerRetryEntry['status']
  detail: string | null
}

function entryOf(row: EntryRow): ForkWorkerRetryEntry {
  return {
    taskId: row.task_id,
    runId: row.run_id,
    dispatchId: row.dispatch_id,
    retryDispatchId: row.retry_dispatch_id,
    attempt: row.attempt,
    reason: row.reason,
    at: row.at,
    dueAt: row.due_at,
    status: row.status,
    detail: row.detail
  }
}

export function listRetries(
  handle: RetryDbHandle,
  filter: { taskId?: string | undefined; runId?: string | undefined } = {},
  limit = 100
): ForkWorkerRetryEntry[] {
  const where: string[] = []
  const params: (string | number)[] = []
  if (filter.taskId) {
    where.push('task_id = ?')
    params.push(filter.taskId)
  }
  if (filter.runId) {
    where.push('run_id = ?')
    params.push(filter.runId)
  }
  const rows = ensureTables(handle)
    .prepare(
      `SELECT task_id, run_id, dispatch_id, retry_dispatch_id, attempt, reason, at, due_at, status, detail
       FROM fork_worker_retries ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY id DESC LIMIT ?`
    )
    .all(...params, limit) as EntryRow[]
  return rows.toReversed().map(entryOf)
}

/** Retries still waiting for their time, for a restart of the app to arm again. */
export function listScheduled(
  handle: RetryDbHandle
): (ForkWorkerRetryEntry & { dueAtMs: number })[] {
  const rows = ensureTables(handle)
    .prepare(
      `SELECT task_id, run_id, dispatch_id, retry_dispatch_id, attempt, reason, at, due_at, status, detail
       FROM fork_worker_retries WHERE status = 'scheduled' ORDER BY id`
    )
    .all() as EntryRow[]
  return rows.map((row) => ({
    ...entryOf(row),
    dueAtMs: Date.parse(row.due_at) || Date.now()
  }))
}

/** Digest: restarts recorded since a time, newest first. */
export function listRetriesSince(handle: RetryDbHandle, sinceIso: string, limit: number) {
  const rows = ensureTables(handle)
    .prepare(
      `SELECT task_id, run_id, dispatch_id, retry_dispatch_id, attempt, reason, at, due_at, status, detail
       FROM fork_worker_retries WHERE julianday(at) >= julianday(?) ORDER BY id DESC LIMIT ?`
    )
    .all(sinceIso, limit) as EntryRow[]
  return rows.map(entryOf)
}

/** The retry that started a Task: a restart's Dispatch belongs to the new Task it created. */
export function retryThatStartedTask(
  handle: RetryDbHandle,
  taskId: string
): ForkWorkerRetryEntry | null {
  const row = ensureTables(handle)
    .prepare(
      `SELECT r.task_id, r.run_id, r.dispatch_id, r.retry_dispatch_id, r.attempt, r.reason, r.at,
              r.due_at, r.status, r.detail
         FROM fork_worker_retries r JOIN dispatch_contexts d ON d.id = r.retry_dispatch_id
        WHERE d.task_id = ? AND r.status = 'started'
        ORDER BY r.id DESC LIMIT 1`
    )
    .get(taskId) as EntryRow | undefined
  return row ? entryOf(row) : null
}
