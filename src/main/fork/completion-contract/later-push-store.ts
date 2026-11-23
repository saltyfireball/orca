// Completion contract, later push (BAD-676, FORK.md): one row per settled Task with
// --require-pr-checks whose pull request Orca keeps an eye on for a while after the settle. The row
// is the whole state of the watch, so an app restart picks it up where it was. Fork-owned table in
// the orchestration database, created on first use.
import type Database from '../../sqlite/sync-database'
import type { ContractDbHandle } from './contract-store'

export type LaterPushWatch = {
  taskId: string
  /** The Dispatch whose worker_done settled the Task. */
  dispatchId: string
  runId: string
  /** The same workspace (local id, or server and its id) for one PR; a newer watch replaces it. */
  workspaceKey: string
  worktreeId: string | null
  /** Set when the worker ran on a paired server: that server reads the pull request. */
  environmentId: string | null
  untilMs: number
  nextAtMs: number
  intervalMs: number
  seenHead: string | null
  notifiedHead: string | null
  prNumber: number | null
  /** Why the watch ended; null while it watches. */
  ended: string | null
  /** 1 while a red push of this Task is listed in the Decision inbox. */
  inbox: boolean
}

const ready = new WeakSet<Database.Database>()

/** Creates the table on first use; the graph reads join it too. */
export function ensureWatchTable(handle: ContractDbHandle): Database.Database {
  const { db } = handle
  if (!ready.has(db)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS fork_done_watches (
        task_id TEXT PRIMARY KEY,
        dispatch_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        workspace_key TEXT NOT NULL,
        worktree_id TEXT,
        environment_id TEXT,
        until_ms INTEGER NOT NULL,
        next_at_ms INTEGER NOT NULL,
        interval_ms INTEGER NOT NULL,
        seen_head TEXT,
        notified_head TEXT,
        pr_number INTEGER,
        ended TEXT,
        inbox INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS fork_done_watches_due ON fork_done_watches (next_at_ms)
        WHERE ended IS NULL;
    `)
    ready.add(db)
  }
  return db
}

type WatchRow = {
  task_id: string
  dispatch_id: string
  run_id: string
  workspace_key: string
  worktree_id: string | null
  environment_id: string | null
  until_ms: number
  next_at_ms: number
  interval_ms: number
  seen_head: string | null
  notified_head: string | null
  pr_number: number | null
  ended: string | null
  inbox: number
}

function watchOf(row: WatchRow): LaterPushWatch {
  return {
    taskId: row.task_id,
    dispatchId: row.dispatch_id,
    runId: row.run_id,
    workspaceKey: row.workspace_key,
    worktreeId: row.worktree_id,
    environmentId: row.environment_id,
    untilMs: row.until_ms,
    nextAtMs: row.next_at_ms,
    intervalMs: row.interval_ms,
    seenHead: row.seen_head,
    notifiedHead: row.notified_head,
    prNumber: row.pr_number,
    ended: row.ended,
    inbox: row.inbox === 1
  }
}

/** Starts a watch, and ends any older one on the same workspace: the newer Task speaks for the PR. */
export function armWatch(
  handle: ContractDbHandle,
  watch: Pick<
    LaterPushWatch,
    | 'taskId'
    | 'dispatchId'
    | 'runId'
    | 'workspaceKey'
    | 'worktreeId'
    | 'environmentId'
    | 'untilMs'
    | 'nextAtMs'
    | 'intervalMs'
  >
): void {
  const db = ensureWatchTable(handle)
  db.prepare(
    `UPDATE fork_done_watches SET ended = ? WHERE workspace_key = ? AND task_id != ? AND ended IS NULL`
  ).run(`replaced by the later Task ${watch.taskId}`, watch.workspaceKey, watch.taskId)
  db.prepare(
    `INSERT OR IGNORE INTO fork_done_watches
       (task_id, dispatch_id, run_id, workspace_key, worktree_id, environment_id, until_ms,
        next_at_ms, interval_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    watch.taskId,
    watch.dispatchId,
    watch.runId,
    watch.workspaceKey,
    watch.worktreeId,
    watch.environmentId,
    watch.untilMs,
    watch.nextAtMs,
    watch.intervalMs
  )
}

/** A Task that cannot be watched (no worker Dispatch): kept so it is not looked at again. */
export function skipWatch(
  handle: ContractDbHandle,
  taskId: string,
  runId: string,
  why: string
): void {
  ensureWatchTable(handle)
    .prepare(
      `INSERT OR IGNORE INTO fork_done_watches
         (task_id, dispatch_id, run_id, workspace_key, until_ms, next_at_ms, interval_ms, ended)
       VALUES (?, '', ?, '', 0, 0, 0, ?)`
    )
    .run(taskId, runId, why)
}

export function readWatch(handle: ContractDbHandle, taskId: string): LaterPushWatch | null {
  const row = ensureWatchTable(handle)
    .prepare('SELECT * FROM fork_done_watches WHERE task_id = ?')
    .get(taskId) as WatchRow | undefined
  return row ? watchOf(row) : null
}

export function dueWatches(handle: ContractDbHandle, nowMs: number): LaterPushWatch[] {
  return (
    ensureWatchTable(handle)
      .prepare(
        'SELECT * FROM fork_done_watches WHERE ended IS NULL AND next_at_ms <= ? ORDER BY next_at_ms'
      )
      .all(nowMs) as WatchRow[]
  ).map(watchOf)
}

/** When the next watch is due; null when nothing is left to watch. */
export function nextDueAt(handle: ContractDbHandle): number | null {
  const row = ensureWatchTable(handle)
    .prepare('SELECT MIN(next_at_ms) AS at FROM fork_done_watches WHERE ended IS NULL')
    .get() as { at: number | null }
  return row.at ?? null
}

export function updateWatch(
  handle: ContractDbHandle,
  taskId: string,
  patch: Partial<
    Pick<
      LaterPushWatch,
      'nextAtMs' | 'intervalMs' | 'seenHead' | 'notifiedHead' | 'prNumber' | 'ended' | 'inbox'
    >
  >
): void {
  const columns: Record<keyof typeof patch, string> = {
    nextAtMs: 'next_at_ms',
    intervalMs: 'interval_ms',
    seenHead: 'seen_head',
    notifiedHead: 'notified_head',
    prNumber: 'pr_number',
    ended: 'ended',
    inbox: 'inbox'
  }
  const entries = Object.entries(patch) as [keyof typeof patch, unknown][]
  if (entries.length === 0) {
    return
  }
  ensureWatchTable(handle)
    .prepare(
      `UPDATE fork_done_watches SET ${entries.map(([key]) => `${columns[key]} = ?`).join(', ')} WHERE task_id = ?`
    )
    .run(
      ...entries.map(([, value]) =>
        typeof value === 'boolean' ? (value ? 1 : 0) : (value as string | number | null)
      ),
      taskId
    )
}

/** Tasks whose later push went red and is still listed in the Decision inbox. */
export function listInboxWatches(handle: ContractDbHandle): LaterPushWatch[] {
  return (
    ensureWatchTable(handle)
      .prepare('SELECT * FROM fork_done_watches WHERE inbox = 1 ORDER BY task_id')
      .all() as WatchRow[]
  ).map(watchOf)
}

/** Live watches whose workspace is the one a local pull request read was about. */
export function watchesOfWorktree(handle: ContractDbHandle, worktreeId: string): LaterPushWatch[] {
  return (
    ensureWatchTable(handle)
      .prepare(
        'SELECT * FROM fork_done_watches WHERE ended IS NULL AND environment_id IS NULL AND worktree_id = ?'
      )
      .all(worktreeId) as WatchRow[]
  ).map(watchOf)
}
