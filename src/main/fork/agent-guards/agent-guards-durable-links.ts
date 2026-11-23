// Agent guards (FORK.md, BAD-766): who started an agent, read from the orchestration database, which
// outlives an app restart (the in-memory notes of a worker start do not). A Dispatch row keeps the
// worker's pane or chat session and its creator's session, pane or handle. Keep electron out.
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'

/** A creator as the Run index names agents: a chat session id, a pane key, or a bare handle. */
export type DurableRunParent = { chat: string } | { pane: string } | { handle: string }

type Creator = {
  creator_orca_session_id: string | null
  creator_pane_key: string | null
  creator_handle: string | null
}

const BY_SESSION = `SELECT creator_orca_session_id, creator_pane_key, creator_handle
  FROM dispatch_contexts WHERE assignee_orca_session_id = ? ORDER BY rowid DESC LIMIT 1`

function parentOf(row: Creator | undefined): DurableRunParent | undefined {
  if (row?.creator_orca_session_id) {
    return { chat: row.creator_orca_session_id }
  }
  if (row?.creator_pane_key) {
    return { pane: row.creator_pane_key }
  }
  return row?.creator_handle ? { handle: row.creator_handle } : undefined
}

/** The newest Dispatch of a terminal worker's pane, or of a chat worker's session, and its creator. */
export function durableRunParent(db: OrchestrationDb, id: string): DurableRunParent | undefined {
  if (id.includes(':')) {
    // A pane key; the handle may have been reissued since, so the pane identity decides.
    return parentOf(db.getLatestDispatchForTerminal('', id))
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the statement selects exactly the Creator columns.
  return parentOf(db.db.prepare(BY_SESSION).get(id) as Creator | undefined)
}

const MISS_TTL_MS = 5_000

/** The reader with a cache: a found link is kept, a miss is asked again after a few seconds. */
export function createDurableRunLinks(getDb: () => OrchestrationDb | null, now = Date.now) {
  const found = new Map<string, DurableRunParent>()
  const missed = new Map<string, number>()
  return (id: string): DurableRunParent | undefined => {
    const known = found.get(id)
    if (known) {
      return known
    }
    const at = missed.get(id)
    if (at !== undefined && now() - at < MISS_TTL_MS) {
      return undefined
    }
    let parent: DurableRunParent | undefined
    try {
      const db = getDb()
      parent = db ? durableRunParent(db, id) : undefined
    } catch (error) {
      console.warn('[fork-agent-guards] could not read a worker link', error)
    }
    if (parent) {
      found.set(id, parent)
      missed.delete(id)
    } else {
      missed.set(id, now())
    }
    return parent
  }
}
