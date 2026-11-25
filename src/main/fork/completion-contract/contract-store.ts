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
  /** BAD-816: the Task's result schema (the coordinator's text); null when it declares none. */
  resultSchema: string | null
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

/** Told when a contract that asks for pull request checks is saved: the later-push watch looks. */
let prContractSaved: ((handle: ContractDbHandle) => void) | null = null

export function onPrContractSaved(listener: ((handle: ContractDbHandle) => void) | null): void {
  prContractSaved = listener
}

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
    // BAD-816: the result schema and the stored value, added on first use to an older table.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SQLite returns the columns this statement selects.
    const columns = db.prepare('PRAGMA table_info(fork_done_contracts)').all() as { name: string }[]
    for (const column of ['result_schema', 'result_value', 'result_at']) {
      if (!columns.some((entry) => entry.name === column)) {
        db.exec(`ALTER TABLE fork_done_contracts ADD COLUMN ${column} TEXT`)
      }
    }
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
  if (contract.requirePrChecks) {
    prContractSaved?.(handle)
  }
}

type ContractRow = {
  checks: string
  result_schema: string | null
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
    resultSchema: row.result_schema ?? null,
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

/**
 * BAD-816: declares the Task's result schema on its own, beside any checks. A Task with only a
 * schema has a row with no checks. A changed schema drops a value stored under the old one.
 */
export function saveResultSchema(handle: ContractDbHandle, taskId: string, schema: string): void {
  ensureTables(handle)
    .prepare(
      `INSERT INTO fork_done_contracts (task_id, checks, result_schema) VALUES (?, '[]', ?)
       ON CONFLICT(task_id) DO UPDATE SET
         result_value = CASE WHEN result_schema IS excluded.result_schema THEN result_value END,
         result_at = CASE WHEN result_schema IS excluded.result_schema THEN result_at END,
         result_schema = excluded.result_schema`
    )
    .run(taskId, schema)
}

/** A retry of the same Task owes its result again. */
export function clearResultValue(handle: ContractDbHandle, taskId: string): void {
  ensureTables(handle)
    .prepare(
      'UPDATE fork_done_contracts SET result_value = NULL, result_at = NULL WHERE task_id = ?'
    )
    .run(taskId)
}

export type StoredResult = { value: string; at: string }

/** The value a worker's done stored on the Task (validated before it was stored). */
export function readResultValue(handle: ContractDbHandle, taskId: string): StoredResult | null {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SQLite returns the columns this statement selects.
  const row = ensureTables(handle)
    .prepare('SELECT result_value, result_at FROM fork_done_contracts WHERE task_id = ?')
    .get(taskId) as { result_value: string | null; result_at: string | null } | undefined
  return row?.result_value ? { value: row.result_value, at: row.result_at ?? '' } : null
}

export function storeResultValue(handle: ContractDbHandle, taskId: string, value: string): void {
  ensureTables(handle)
    .prepare(
      "UPDATE fork_done_contracts SET result_value = ?, result_at = datetime('now') WHERE task_id = ? AND result_schema IS NOT NULL"
    )
    .run(value, taskId)
}

/** Stored values of a Run's Tasks, oldest first, for the Run read. */
export function listRunResults(
  handle: ContractDbHandle,
  runId: string
): { taskId: string; value: string; at: string }[] {
  ensureTables(handle)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SQLite returns the columns this statement selects.
  const rows = handle.db
    .prepare(
      `SELECT c.task_id, c.result_value, c.result_at FROM fork_done_contracts c
       JOIN tasks t ON t.id = c.task_id
       WHERE t.run_id = ? AND c.result_value IS NOT NULL ORDER BY c.result_at, c.task_id`
    )
    .all(runId) as { task_id: string; result_value: string; result_at: string | null }[]
  return rows.map((row) => ({
    taskId: row.task_id,
    value: row.result_value,
    at: row.result_at ?? ''
  }))
}

/** An attempt that changes no round or escalation: the later-push watch's reads of a settled Task. */
export function insertAttempt(
  handle: ContractDbHandle,
  input: {
    taskId: string
    dispatchId: string | null
    outcome: 'pass' | 'fail'
    results: ForkDoneCheckResult[]
  }
): void {
  ensureTables(handle)
    .prepare(
      'INSERT INTO fork_done_attempts (task_id, dispatch_id, outcome, results) VALUES (?, ?, ?, ?)'
    )
    .run(input.taskId, input.dispatchId, input.outcome, JSON.stringify(input.results))
}

/** The newest pull request result that named its head: what the Task was last judged on. */
export function lastPrResult(
  handle: ContractDbHandle,
  taskId: string
): (ForkDoneCheckResult & { headSha: string }) | null {
  for (const attempt of listAttempts(handle, taskId).toReversed()) {
    const pr = attempt.results.find(
      (result): result is ForkDoneCheckResult & { headSha: string } =>
        typeof result.headSha === 'string' && !result.pending
    )
    if (pr) {
      return pr
    }
  }
  return null
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
