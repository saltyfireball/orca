// FORK.md "Agent profiles" (BAD-741): the preamble a Task's worker was started with, so a start with
// no spec text (`--task`, `--retry-of`), a follow-up and an automatic retry still send it. One
// fork-owned table of the orchestration database, created on first use; upstream never reads it.
import type Database from '../../sqlite/sync-database'

type Handle = {
  db: Database.Database
  getDispatchContextById: (id: string) => { task_id: string } | undefined | null
}

const ready = new WeakSet<Database.Database>()
// The worker preamble is built right after the start stores this, in the same start.
const recent = new Map<string, string>()
const RECENT_MAX = 500

function ensureTable(db: Database.Database): Database.Database {
  if (!ready.has(db)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS fork_task_agent_profiles (
        task_id TEXT PRIMARY KEY,
        profile TEXT NOT NULL,
        preamble TEXT NOT NULL
      );
    `)
    ready.add(db)
  }
  return db
}

function remember(taskId: string, preamble: string): void {
  recent.delete(taskId)
  recent.set(taskId, preamble)
  if (recent.size > RECENT_MAX) {
    const oldest = recent.keys().next()
    if (!oldest.done) {
      recent.delete(oldest.value)
    }
  }
}

function read(db: Database.Database, taskId: string): { profile: string; preamble: string } | null {
  const row: unknown = ensureTable(db)
    .prepare('SELECT profile, preamble FROM fork_task_agent_profiles WHERE task_id = ?')
    .get(taskId)
  return row &&
    typeof row === 'object' &&
    'profile' in row &&
    typeof row.profile === 'string' &&
    'preamble' in row &&
    typeof row.preamble === 'string'
    ? { profile: row.profile, preamble: row.preamble }
    : null
}

function save(db: Database.Database, taskId: string, profile: string, preamble: string): void {
  ensureTable(db)
    .prepare(
      `INSERT INTO fork_task_agent_profiles (task_id, profile, preamble) VALUES (?, ?, ?)
       ON CONFLICT(task_id) DO UPDATE SET profile = excluded.profile, preamble = excluded.preamble`
    )
    .run(taskId, profile, preamble)
  remember(taskId, preamble)
}

/**
 * At a worker start: a start under `--profile` keeps its preamble for the Task; any other start
 * of a Task that has one, or that continues a Dispatch whose Task has one, takes it up again.
 */
export function forkStoreTaskProfilePreamble(
  handle: Handle,
  taskId: string,
  started: { profile: string; preamble?: string } | undefined,
  continuesDispatchId: string | undefined
): void {
  if (started?.preamble) {
    save(handle.db, taskId, started.profile, started.preamble)
    return
  }
  if (started) {
    return
  }
  const own = read(handle.db, taskId)
  if (own) {
    remember(taskId, own.preamble)
    return
  }
  const from = continuesDispatchId
    ? handle.getDispatchContextById(continuesDispatchId)?.task_id
    : undefined
  const carried = from && from !== taskId ? read(handle.db, from) : null
  if (carried) {
    save(handle.db, taskId, carried.profile, carried.preamble)
  }
}

export function forkTaskProfilePreamble(taskId: string): string | undefined {
  return recent.get(taskId)
}

export function resetForkTaskProfilePreamblesForTests(): void {
  recent.clear()
}
