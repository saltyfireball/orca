// Idle recovery (FORK.md), item B: which chats are orchestration workers or coordinators. One
// read of the dispatch table per listing, joined in memory. A dispatch whose two ends are the
// same chat is bookkeeping and gives that chat no role.
import type { IdleRecoveryRole } from '../../../shared/fork/idle-recovery'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import {
  isEquivalentPaneKey,
  paneKeyMatchSuffix
} from '../../runtime/orchestration/db/pane-key-match'

export type IdleRecoveryDispatchRow = {
  assignee_pane_key: string | null
  assignee_orca_session_id: string | null
  creator_pane_key: string | null
  creator_orca_session_id: string | null
  status: string
}

export function readIdleRecoveryDispatchRows(db: OrchestrationDb): IdleRecoveryDispatchRow[] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the SELECT names exactly these columns.
  return db.db
    .prepare(
      `SELECT d.assignee_pane_key, d.assignee_orca_session_id,
              COALESCE(d.creator_pane_key, r.coordinator_pane_key) AS creator_pane_key,
              COALESCE(d.creator_orca_session_id, r.coordinator_orca_session_id)
                AS creator_orca_session_id,
              d.status
       FROM dispatch_contexts d LEFT JOIN runs r ON r.id = d.run_id`
    )
    .all() as IdleRecoveryDispatchRow[]
}

const OPEN_DISPATCH: readonly string[] = ['pending', 'dispatched']

type Party = { paneKey: string | null; sessionId: string | null }

/** How a chat is looked up: a native chat by session id, any agent by its pane key. */
export type IdleRecoveryRoleSubject = { paneKey: string; sessionId: string | null }

export type IdleRecoveryRoleFacts = { role: IdleRecoveryRole; openDispatches: boolean }

export type IdleRecoveryRoleIndex = (subject: IdleRecoveryRoleSubject) => IdleRecoveryRoleFacts

class PartySet {
  private readonly sessions = new Set<string>()
  private readonly panes = new Map<string, string[]>()

  add(party: Party): void {
    if (party.sessionId) {
      this.sessions.add(party.sessionId)
    }
    if (party.paneKey) {
      const suffix = paneKeyMatchSuffix(party.paneKey)
      const keys = this.panes.get(suffix)
      if (keys) {
        keys.push(party.paneKey)
      } else {
        this.panes.set(suffix, [party.paneKey])
      }
    }
  }

  has(subject: IdleRecoveryRoleSubject): boolean {
    if (subject.sessionId && this.sessions.has(subject.sessionId)) {
      return true
    }
    const keys = this.panes.get(paneKeyMatchSuffix(subject.paneKey))
    return keys?.some((key) => isEquivalentPaneKey(key, subject.paneKey)) ?? false
  }
}

function sameParty(a: Party, b: Party): boolean {
  return (
    (a.sessionId !== null && a.sessionId === b.sessionId) ||
    (a.paneKey !== null && b.paneKey !== null && isEquivalentPaneKey(a.paneKey, b.paneKey))
  )
}

/** A worker that also dispatched work of its own still reads as a worker. */
export function buildIdleRecoveryRoleIndex(
  rows: readonly IdleRecoveryDispatchRow[]
): IdleRecoveryRoleIndex {
  const workers = new PartySet()
  const coordinators = new PartySet()
  const busy = new PartySet()
  for (const row of rows) {
    const assignee = { paneKey: row.assignee_pane_key, sessionId: row.assignee_orca_session_id }
    const creator = { paneKey: row.creator_pane_key, sessionId: row.creator_orca_session_id }
    if (sameParty(assignee, creator)) {
      continue
    }
    workers.add(assignee)
    coordinators.add(creator)
    if (OPEN_DISPATCH.includes(row.status)) {
      busy.add(creator)
    }
  }
  return (subject) => {
    const openDispatches = busy.has(subject)
    if (workers.has(subject)) {
      return { role: 'worker', openDispatches }
    }
    return { role: coordinators.has(subject) ? 'coordinator' : 'standalone', openDispatches }
  }
}
