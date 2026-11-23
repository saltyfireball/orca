// Worker retry policy (BAD-681, FORK.md): the retry a crew row shows, read from the retry table by
// the row's Dispatch. Called while a crew snapshot is built, so it only reads: a database where no
// retry was ever recorded has no table yet, and that is one catalog lookup.
import type Database from '../../sqlite/sync-database'
import type { ForkCrewRetryState } from '../../../shared/fork/worker-retry-crew'
import { WORKER_RETRY_HOLD_TEXT } from '../../../shared/fork/worker-retry'

/** Skips that are a retry Orca wanted and could not make; the rest were never retries. */
const GAVE_UP_SKIPS = new Set([
  WORKER_RETRY_HOLD_TEXT.exhausted,
  WORKER_RETRY_HOLD_TEXT['cannot-resume'],
  WORKER_RETRY_HOLD_TEXT['no-coordinator']
])

type Row = {
  attempt: number
  reason: string
  status: string
  due_at: string
  detail: string | null
}

const present = new WeakSet<Database.Database>()

function hasTable(db: Database.Database): boolean {
  if (present.has(db)) {
    return true
  }
  const found =
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fork_worker_retries'")
      .get() !== undefined
  if (found) {
    present.add(db)
  }
  return found
}

function endedState(row: Row): ForkCrewRetryState | undefined {
  const base = { attempt: row.attempt, reason: row.reason, side: 'ended' as const }
  switch (row.status) {
    case 'scheduled':
      return { ...base, state: 'waiting', dueAt: row.due_at }
    case 'started':
      return { ...base, state: 'restarted' }
    case 'failed':
      return { ...base, state: 'gave-up', ...(row.detail ? { detail: row.detail } : {}) }
    case 'skipped':
      return row.detail && GAVE_UP_SKIPS.has(row.detail)
        ? { ...base, state: 'gave-up', detail: row.detail }
        : undefined
    default:
      return undefined
  }
}

export function forkCrewRetryOf(
  handle: { db: Database.Database } | null,
  dispatchId: string
): ForkCrewRetryState | undefined {
  if (!handle || !hasTable(handle.db)) {
    return undefined
  }
  const columns = 'attempt, reason, status, due_at, detail'
  const ended = handle.db
    .prepare(`SELECT ${columns} FROM fork_worker_retries WHERE dispatch_id = ?`)
    .get(dispatchId) as Row | undefined
  const state = ended && endedState(ended)
  if (state) {
    return state
  }
  const started = handle.db
    .prepare(
      `SELECT ${columns} FROM fork_worker_retries WHERE retry_dispatch_id = ? AND status = 'started'`
    )
    .get(dispatchId) as Row | undefined
  return started
    ? { attempt: started.attempt, reason: started.reason, state: 'restarted', side: 'restart' }
    : undefined
}

/** The hook the crew snapshot calls for each worker row; returns the row. */
export function forkDecorateCrewRetry<Row extends { forkRetry?: ForkCrewRetryState }>(
  row: Row,
  handle: { db: Database.Database } | null,
  dispatchId: string
): Row {
  const retry = forkCrewRetryOf(handle, dispatchId)
  if (retry) {
    row.forkRetry = retry
  }
  return row
}
