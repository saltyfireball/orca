// FORK.md "Agent profiles" (BAD-741): what a Task's worker was first started with under `--profile`
// (and `--mcp-profile`), so a start with no spec text (`--task`, `--retry-of`), a follow-up and an
// automatic retry start the same way: the preamble, the agent, the permission mode, the account
// (its id or the profile's own name for it, never a credential) and the MCP profile name. One
// fork-owned table of the orchestration database, created on first use; upstream never reads it.
import type Database from '../../sqlite/sync-database'
import {
  FORK_AGENT_PROFILE_PERMISSION_MODES,
  type ForkAgentProfilePermissionMode
} from '../../../shared/fork/agent-profiles/agent-profiles-types'

type Handle = {
  db: Database.Database
  getDispatchContextById: (id: string) => { task_id: string } | undefined | null
}

export type ForkTaskLaunch = {
  /** The profile's name; empty when only `--mcp-profile` was given. */
  profile: string
  preamble: string
  agent?: string
  permissionMode?: ForkAgentProfilePermissionMode
  account?: string
  mcpProfile?: string
}

const ready = new WeakSet<Database.Database>()
// The worker preamble is built right after the start stores this, in the same start.
const recent = new Map<string, string>()
const RECENT_MAX = 500
const COLUMNS = ['agent', 'permission_mode', 'account', 'mcp_profile'] as const

function ensureTable(db: Database.Database): Database.Database {
  if (!ready.has(db)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS fork_task_agent_profiles (
        task_id TEXT PRIMARY KEY,
        profile TEXT NOT NULL,
        preamble TEXT NOT NULL
      );
    `)
    // Tables made before the mode and account were kept get the columns here.
    const have = new Set(
      db
        .prepare('PRAGMA table_info(fork_task_agent_profiles)')
        .all()
        .map((column) => Object.fromEntries(Object.entries(column ?? {})).name)
    )
    for (const column of COLUMNS) {
      if (!have.has(column)) {
        db.exec(`ALTER TABLE fork_task_agent_profiles ADD COLUMN ${column} TEXT`)
      }
    }
    ready.add(db)
  }
  return db
}

function remember(taskId: string, preamble: string): void {
  recent.delete(taskId)
  if (!preamble) {
    return
  }
  recent.set(taskId, preamble)
  if (recent.size > RECENT_MAX) {
    const oldest = recent.keys().next()
    if (!oldest.done) {
      recent.delete(oldest.value)
    }
  }
}

function text(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function read(db: Database.Database, taskId: string): ForkTaskLaunch | null {
  const row: unknown = ensureTable(db)
    .prepare(
      'SELECT profile, preamble, agent, permission_mode, account, mcp_profile FROM fork_task_agent_profiles WHERE task_id = ?'
    )
    .get(taskId)
  if (!row || typeof row !== 'object') {
    return null
  }
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(row))
  const mode = FORK_AGENT_PROFILE_PERMISSION_MODES.find(
    (entry) => entry === text(fields, 'permission_mode')
  )
  const agent = text(fields, 'agent')
  const account = text(fields, 'account')
  const mcpProfile = text(fields, 'mcp_profile')
  return {
    profile: text(fields, 'profile') ?? '',
    preamble: text(fields, 'preamble') ?? '',
    ...(agent ? { agent } : {}),
    ...(mode ? { permissionMode: mode } : {}),
    ...(account ? { account } : {}),
    ...(mcpProfile ? { mcpProfile } : {})
  }
}

function save(db: Database.Database, taskId: string, launch: ForkTaskLaunch): void {
  ensureTable(db)
    .prepare(
      `INSERT INTO fork_task_agent_profiles
         (task_id, profile, preamble, agent, permission_mode, account, mcp_profile)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(task_id) DO UPDATE SET profile = excluded.profile, preamble = excluded.preamble,
         agent = excluded.agent, permission_mode = excluded.permission_mode,
         account = excluded.account, mcp_profile = excluded.mcp_profile`
    )
    .run(
      taskId,
      launch.profile,
      launch.preamble,
      launch.agent ?? null,
      launch.permissionMode ?? null,
      launch.account ?? null,
      launch.mcpProfile ?? null
    )
  remember(taskId, launch.preamble)
}

function keeps(launch: ForkTaskLaunch): boolean {
  return Boolean(launch.preamble || launch.permissionMode || launch.account || launch.mcpProfile)
}

/** The Task a start continues: a follow-up's or retry's Dispatch, else the Task it names. */
export function forkContinuedTaskId(
  handle: Handle,
  taskId: string | undefined,
  continuesDispatchId: string | undefined
): string | undefined {
  return (
    (continuesDispatchId
      ? handle.getDispatchContextById(continuesDispatchId)?.task_id
      : undefined) ?? taskId
  )
}

export function forkReadTaskLaunch(handle: Handle, taskId: string): ForkTaskLaunch | null {
  return read(handle.db, taskId)
}

/**
 * At a worker start: a start under its own `--profile` or `--mcp-profile` keeps what it started
 * with for the Task; any other start of a Task that has a row, or that continues a Dispatch whose
 * Task has one, takes it up again, unchanged, so a later policy can narrow it but never widen it.
 */
export function forkStoreTaskProfilePreamble(
  handle: Handle,
  taskId: string,
  started: ForkTaskLaunch | undefined,
  continuesDispatchId: string | undefined
): void {
  if (started && keeps(started)) {
    save(handle.db, taskId, started)
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
    save(handle.db, taskId, carried)
  }
}

export function forkTaskProfilePreamble(taskId: string): string | undefined {
  return recent.get(taskId)
}

export function resetForkTaskProfilePreamblesForTests(): void {
  recent.clear()
}
