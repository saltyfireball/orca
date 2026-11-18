// Digest (SLRM-2388, FORK.md): the orchestration tasks of this host that finished or failed in
// the window, read straight from its orchestration database. Read-only.
import type { ForkDigestTask } from '../../../shared/fork/digest'

export const FORK_DIGEST_MAX_TASKS = 100
const MAX_RESULT_CHARS = 300

/** The one statement this reader needs; the orchestration database's connection satisfies it. */
export type ForkDigestTaskDb = {
  prepare: (sql: string) => { all: (...params: (string | number)[]) => unknown[] }
}

const TASKS_SQL = `SELECT id, task_title, display_name, spec, status, result, completed_at
  FROM tasks
  WHERE status IN ('completed', 'failed')
    AND completed_at IS NOT NULL
    AND julianday(completed_at) >= julianday(?)
  ORDER BY julianday(completed_at) DESC
  LIMIT ?`

type Row = Record<string, unknown>

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** SQLite writes either ISO with a zone or `YYYY-MM-DD HH:MM:SS` in UTC. */
export function parseForkDigestDbTime(value: unknown): number | null {
  const raw = text(value).trim()
  if (!raw) {
    return null
  }
  const iso = /[zZ]|[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`
  const at = Date.parse(iso)
  return Number.isFinite(at) ? at : null
}

function titleOf(row: Row): string {
  const named = text(row.display_name).trim() || text(row.task_title).trim()
  if (named) {
    return named
  }
  const firstLine =
    text(row.spec)
      .split('\n')
      .find((line) => line.trim()) ?? ''
  return firstLine.trim() || text(row.id)
}

function resultOf(value: unknown): string | null {
  const raw = text(value).replace(/\s+/g, ' ').trim()
  if (!raw) {
    return null
  }
  return raw.length > MAX_RESULT_CHARS ? `${raw.slice(0, MAX_RESULT_CHARS - 3)}...` : raw
}

export function readForkDigestTasks(db: ForkDigestTaskDb, since: number): ForkDigestTask[] {
  const rows = db.prepare(TASKS_SQL).all(new Date(since).toISOString(), FORK_DIGEST_MAX_TASKS)
  const tasks: ForkDigestTask[] = []
  for (const value of rows) {
    const row: Row = isRow(value) ? value : {}
    const at = parseForkDigestDbTime(row.completed_at)
    const status = row.status === 'completed' || row.status === 'failed' ? row.status : null
    if (at === null || status === null || at < since) {
      continue
    }
    tasks.push({ id: text(row.id), title: titleOf(row), status, at, result: resultOf(row.result) })
  }
  return tasks
}
