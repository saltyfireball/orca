// Completion contract (BAD-676, FORK.md): the contract of a Task and each check attempt, in two
// fork-owned tables of the orchestration database. They are created on first use, so upstream's
// schema and its version stay untouched. Rows are keyed by Task id and never read by upstream.
import type Database from '../../sqlite/sync-database'
import type {
  ForkDoneCheckResult,
  ForkDoneContract
} from '../../../shared/fork/completion-contract'

/** The one handle the store needs; `OrchestrationDb.db` satisfies it. */
export type ContractDbHandle = { db: Database.Database }

export type ContractState = {
  contract: ForkDoneContract
  failedRounds: number
  pendingReports: number
  escalated: boolean
}

export type ContractAttempt = {
  id: number
  taskId: string
  dispatchId: string | null
  at: string
  outcome: 'pass' | 'fail' | 'pending' | 'skipped'
  results: ForkDoneCheckResult[]
}

const ready = new WeakSet<Database.Database>()

function ensureTables(handle: ContractDbHandle): Database.Database {
  const { db } = handle
  if (!ready.has(db)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS fork_done_contracts (
        task_id TEXT PRIMARY KEY,
        checks TEXT NOT NULL,
        require_pr_checks INTEGER NOT NULL DEFAULT 0,
        max_rounds INTEGER,
        failed_rounds INTEGER NOT NULL DEFAULT 0,
        pending_reports INTEGER NOT NULL DEFAULT 0,
        escalated INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS fork_done_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        dispatch_id TEXT,
        at TEXT NOT NULL DEFAULT (datetime('now')),
        outcome TEXT NOT NULL,
        results TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS fork_done_attempts_task ON fork_done_attempts (task_id, id);
    `)
    ready.add(db)
  }
  return db
}

export function saveContract(
  handle: ContractDbHandle,
  taskId: string,
  contract: ForkDoneContract
): void {
  ensureTables(handle)
    .prepare(
      `INSERT INTO fork_done_contracts (task_id, checks, require_pr_checks, max_rounds)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(task_id) DO UPDATE SET checks = excluded.checks,
         require_pr_checks = excluded.require_pr_checks, max_rounds = excluded.max_rounds,
         failed_rounds = 0, pending_reports = 0, escalated = 0`
    )
    .run(
      taskId,
      JSON.stringify(contract.checks),
      contract.requirePrChecks ? 1 : 0,
      contract.maxRounds
    )
}

type ContractRow = {
  checks: string
  require_pr_checks: number
  max_rounds: number | null
  failed_rounds: number
  pending_reports: number
  escalated: number
}

export function readContract(handle: ContractDbHandle, taskId: string): ContractState | null {
  const row = ensureTables(handle)
    .prepare('SELECT * FROM fork_done_contracts WHERE task_id = ?')
    .get(taskId) as ContractRow | undefined
  if (!row) {
    return null
  }
  let checks: string[] = []
  try {
    const parsed: unknown = JSON.parse(row.checks)
    checks = Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : []
  } catch {
    checks = []
  }
  return {
    contract: {
      checks,
      requirePrChecks: row.require_pr_checks === 1,
      maxRounds: row.max_rounds
    },
    failedRounds: row.failed_rounds,
    pendingReports: row.pending_reports,
    escalated: row.escalated === 1
  }
}

export function recordAttempt(
  handle: ContractDbHandle,
  input: {
    taskId: string
    dispatchId: string | null
    outcome: ContractAttempt['outcome']
    results: ForkDoneCheckResult[]
    failedRounds: number
    pendingReports: number
    escalated: boolean
  }
): void {
  const db = ensureTables(handle)
  db.exec('BEGIN')
  try {
    db.prepare(
      'INSERT INTO fork_done_attempts (task_id, dispatch_id, outcome, results) VALUES (?, ?, ?, ?)'
    ).run(input.taskId, input.dispatchId, input.outcome, JSON.stringify(input.results))
    db.prepare(
      'UPDATE fork_done_contracts SET failed_rounds = ?, pending_reports = ?, escalated = ? WHERE task_id = ?'
    ).run(input.failedRounds, input.pendingReports, input.escalated ? 1 : 0, input.taskId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** A gate the Task asked for did not run: kept as an attempt so `orca contract show` says so. */
export function recordSkip(
  handle: ContractDbHandle,
  taskId: string,
  dispatchId: string | null,
  note: string
): void {
  const results: ForkDoneCheckResult[] = [
    { check: 'not run', ok: true, exitCode: null, output: note, durationMs: 0 }
  ]
  ensureTables(handle)
    .prepare(
      "INSERT INTO fork_done_attempts (task_id, dispatch_id, outcome, results) VALUES (?, ?, 'skipped', ?)"
    )
    .run(taskId, dispatchId, JSON.stringify(results))
}

export function listAttempts(handle: ContractDbHandle, taskId: string): ContractAttempt[] {
  const rows = ensureTables(handle)
    .prepare('SELECT * FROM fork_done_attempts WHERE task_id = ? ORDER BY id')
    .all(taskId) as {
    id: number
    task_id: string
    dispatch_id: string | null
    at: string
    outcome: ContractAttempt['outcome']
    results: string
  }[]
  return rows.map((row) => {
    let results: ForkDoneCheckResult[] = []
    try {
      const parsed: unknown = JSON.parse(row.results)
      results = Array.isArray(parsed) ? (parsed as ForkDoneCheckResult[]) : []
    } catch {
      results = []
    }
    return {
      id: row.id,
      taskId: row.task_id,
      dispatchId: row.dispatch_id,
      at: row.at,
      outcome: row.outcome,
      results
    }
  })
}

/** Tasks whose contract is escalated and not yet answered, for the Decision inbox. */
export function listEscalated(handle: ContractDbHandle): string[] {
  return (
    ensureTables(handle)
      .prepare('SELECT task_id FROM fork_done_contracts WHERE escalated = 1 ORDER BY created_at')
      .all() as { task_id: string }[]
  ).map((row) => row.task_id)
}

export function clearEscalation(handle: ContractDbHandle, taskId: string): void {
  ensureTables(handle)
    .prepare('UPDATE fork_done_contracts SET escalated = 2 WHERE task_id = ? AND escalated = 1')
    .run(taskId)
}
