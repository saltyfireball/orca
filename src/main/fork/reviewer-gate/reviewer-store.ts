// Reviewer gate (BAD-683, FORK.md): a Task's review request and each review run, in two fork-owned
// tables of the orchestration database. They are created on first use, so upstream's schema and
// its version stay untouched. Rows are keyed by Task id and never read by upstream.
import type Database from '../../sqlite/sync-database'
import type {
  ForkReviewGate,
  ReviewAgent,
  ReviewFocus,
  ReviewGateState,
  ReviewRunRecord,
  ReviewRunStatus
} from '../../../shared/fork/reviewer-gate'

export type ReviewDbHandle = { db: Database.Database }

const ready = new WeakSet<Database.Database>()

function ensureTables(handle: ReviewDbHandle): Database.Database {
  const { db } = handle
  if (!ready.has(db)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS fork_review_gates (
        task_id TEXT PRIMARY KEY,
        focus TEXT NOT NULL,
        agent TEXT,
        max_rounds INTEGER,
        repeat_reports INTEGER NOT NULL DEFAULT 0,
        escalated INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS fork_review_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        round INTEGER NOT NULL,
        head_key TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        reviewer TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        findings_count INTEGER NOT NULL DEFAULT 0,
        output TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS fork_review_runs_task ON fork_review_runs (task_id, id);
    `)
    // A review the app was closed during never finishes; a new head or a retry reviews it again.
    db.exec(
      "UPDATE fork_review_runs SET status = 'error', finished_at = datetime('now'), output = 'Orca closed before the review finished.' WHERE status = 'running'"
    )
    // BAD-763: a row the all-Tasks setting made, as opposed to a review the Task asked for.
    const columns = db.prepare('PRAGMA table_info(fork_review_gates)').all() as { name: string }[]
    if (!columns.some((column) => column.name === 'implicit')) {
      db.exec('ALTER TABLE fork_review_gates ADD COLUMN implicit INTEGER NOT NULL DEFAULT 0')
    }
    // BAD-820: how the worker heard the last review result, so the Decision inbox row says what happened.
    if (!columns.some((column) => column.name === 'worker_told')) {
      db.exec('ALTER TABLE fork_review_gates ADD COLUMN worker_told TEXT')
    }
    ready.add(db)
  }
  return db
}

type GateRow = {
  focus: ReviewFocus
  agent: ReviewAgent | null
  max_rounds: number | null
  repeat_reports: number
  escalated: number
  implicit: number
}

type RunRow = {
  id: number
  task_id: string
  round: number
  head_key: string
  head_sha: string
  reviewer: ReviewAgent
  model: string
  status: ReviewRunStatus
  findings_count: number
  output: string
  started_at: string
  finished_at: string | null
}

function runOf(row: RunRow): ReviewRunRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    round: row.round,
    headKey: row.head_key,
    headSha: row.head_sha,
    reviewer: row.reviewer,
    model: row.model,
    status: row.status,
    findingsCount: row.findings_count,
    output: row.output,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  }
}

export function saveReviewGate(
  handle: ReviewDbHandle,
  taskId: string,
  gate: ForkReviewGate,
  implicit = false
): void {
  ensureTables(handle)
    .prepare(
      `INSERT INTO fork_review_gates (task_id, focus, agent, max_rounds, implicit) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(task_id) DO UPDATE SET focus = excluded.focus, agent = excluded.agent,
         max_rounds = excluded.max_rounds, implicit = excluded.implicit, repeat_reports = 0, escalated = 0,
         worker_told = NULL`
    )
    .run(taskId, gate.focus, gate.agent, gate.maxRounds, implicit ? 1 : 0)
}

/** The Task's stored review request, or null when it has none. */
export function readReviewGate(handle: ReviewDbHandle, taskId: string): ReviewGateState | null {
  const row = ensureTables(handle)
    .prepare(
      'SELECT focus, agent, max_rounds, repeat_reports, escalated, implicit FROM fork_review_gates WHERE task_id = ?'
    )
    .get(taskId) as GateRow | undefined
  return row
    ? {
        gate: { focus: row.focus, agent: row.agent, maxRounds: row.max_rounds },
        repeatReports: row.repeat_reports,
        escalated: row.escalated === 1,
        implicit: row.implicit === 1
      }
    : null
}

export function setRepeatReports(handle: ReviewDbHandle, taskId: string, count: number): void {
  ensureTables(handle)
    .prepare('UPDATE fork_review_gates SET repeat_reports = ? WHERE task_id = ?')
    .run(count, taskId)
}

export function setReviewEscalated(
  handle: ReviewDbHandle,
  taskId: string,
  escalated: boolean
): void {
  ensureTables(handle)
    .prepare('UPDATE fork_review_gates SET escalated = ? WHERE task_id = ?')
    .run(escalated ? 1 : 0, taskId)
}

/**
 * BAD-820: how the last review result reached the worker. 'sent' into its chat or terminal,
 * 'mailed' to its orchestration mailbox when that could not be done, 'not-told' when neither
 * worked; null while Orca is still trying (or before any result).
 */
export type ReviewWorkerTold = 'sent' | 'mailed' | 'not-told'

export function setReviewWorkerTold(
  handle: ReviewDbHandle,
  taskId: string,
  told: ReviewWorkerTold | null
): void {
  ensureTables(handle)
    .prepare('UPDATE fork_review_gates SET worker_told = ? WHERE task_id = ?')
    .run(told, taskId)
}

export function readReviewWorkerTold(
  handle: ReviewDbHandle,
  taskId: string
): ReviewWorkerTold | null {
  const row = ensureTables(handle)
    .prepare('SELECT worker_told FROM fork_review_gates WHERE task_id = ?')
    .get(taskId) as { worker_told: ReviewWorkerTold | null } | undefined
  return row?.worker_told ?? null
}

/** Tasks whose review escalated and is not yet answered, for the Decision inbox. */
export function listReviewEscalated(handle: ReviewDbHandle): string[] {
  return (
    ensureTables(handle)
      .prepare('SELECT task_id FROM fork_review_gates WHERE escalated = 1 ORDER BY created_at')
      .all() as { task_id: string }[]
  ).map((row) => row.task_id)
}

export function listReviewRuns(handle: ReviewDbHandle, taskId: string): ReviewRunRecord[] {
  return (
    ensureTables(handle)
      .prepare('SELECT * FROM fork_review_runs WHERE task_id = ? ORDER BY id')
      .all(taskId) as RunRow[]
  ).map(runOf)
}

/** The newest run of this exact head of the Task. */
export function latestRunOfHead(
  handle: ReviewDbHandle,
  taskId: string,
  headKey: string
): ReviewRunRecord | null {
  const row = ensureTables(handle)
    .prepare(
      'SELECT * FROM fork_review_runs WHERE task_id = ? AND head_key = ? ORDER BY id DESC LIMIT 1'
    )
    .get(taskId, headKey) as RunRow | undefined
  return row ? runOf(row) : null
}

export function countErrorRunsOfHead(
  handle: ReviewDbHandle,
  taskId: string,
  headKey: string
): number {
  const row = ensureTables(handle)
    .prepare(
      "SELECT COUNT(*) AS n FROM fork_review_runs WHERE task_id = ? AND head_key = ? AND status = 'error'"
    )
    .get(taskId, headKey) as { n: number }
  return row.n
}

/** Reviews of this Task that found something: each one is a round used. */
export function countFindingRuns(handle: ReviewDbHandle, taskId: string): number {
  const row = ensureTables(handle)
    .prepare("SELECT COUNT(*) AS n FROM fork_review_runs WHERE task_id = ? AND status = 'findings'")
    .get(taskId) as { n: number }
  return row.n
}

/** Records a started review. The unique-per-head rule is the caller's: it reads the head first, in one tick. */
export function startReviewRun(
  handle: ReviewDbHandle,
  input: {
    taskId: string
    round: number
    headKey: string
    headSha: string
    reviewer: ReviewAgent
    model: string
  }
): number {
  const result = ensureTables(handle)
    .prepare(
      `INSERT INTO fork_review_runs (task_id, round, head_key, head_sha, reviewer, model, status)
       VALUES (?, ?, ?, ?, ?, ?, 'running')`
    )
    .run(input.taskId, input.round, input.headKey, input.headSha, input.reviewer, input.model)
  return Number(result.lastInsertRowid)
}

export function finishReviewRun(
  handle: ReviewDbHandle,
  runId: number,
  result: { status: Exclude<ReviewRunStatus, 'running'>; findingsCount: number; output: string }
): ReviewRunRecord {
  const db = ensureTables(handle)
  db.prepare(
    `UPDATE fork_review_runs SET status = ?, findings_count = ?, output = ?,
       finished_at = datetime('now') WHERE id = ?`
  ).run(result.status, result.findingsCount, result.output, runId)
  return runOf(db.prepare('SELECT * FROM fork_review_runs WHERE id = ?').get(runId) as RunRow)
}
