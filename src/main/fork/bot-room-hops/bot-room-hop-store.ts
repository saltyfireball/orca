// Bot room hop limit (BAD-801, FORK.md "Bot room hop limit"): the hand-offs held at the limit, kept
// beside the room store in its own database so a restart keeps them, and how deep a room line sits
// in its chain of hand-offs, read from the stored lines themselves.
import type Database from '../../sqlite/sync-database'
import { startsBotGroupRequest, type BotGroupMessage } from '../../../shared/bots/bot-group-schema'
import type { BotGroupStore } from '../../bots/bot-group-store'

/** held: waiting on the owner. continuing: claimed by a Continue whose wake has not finished (a
 *  restart settles it). continued: the owner's Continue let it go on once. dismissed: the owner left
 *  the room as it was. moot: a later person post or a Stop ended the chain. */
export type BotRoomHopHoldState = 'held' | 'continuing' | 'continued' | 'dismissed' | 'moot'

/** A hold the owner let go on: it passes the limit once and starts a fresh count. */
export function botRoomHopHoldLetGo(hold: BotRoomHopHold | null): boolean {
  return hold?.state === 'continuing' || hold?.state === 'continued'
}

/** One member turn whose hand-off was held at the limit. */
export type BotRoomHopHold = {
  operationId: string
  messageId: string
  groupId: string
  threadId: string | null
  rootRequestId: string
  rootSequence: number
  /** The room's newest sequence when it was held; a request line past it makes the hold moot. */
  heldAfter: number
  /** The hop the hand-off would have been. */
  hop: number
  replyFull: string
  replySaved: string
  targets: string[]
  heldAt: number
  state: BotRoomHopHoldState
}

const prepared = new WeakSet<Database>()

function ensureTable(db: Database): void {
  if (prepared.has(db)) {
    return
  }
  db.exec(`CREATE TABLE IF NOT EXISTS fork_bot_room_hop_holds (
      operation_id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      thread_id TEXT,
      root_request_id TEXT NOT NULL,
      root_sequence INTEGER NOT NULL,
      held_after INTEGER NOT NULL,
      hop INTEGER NOT NULL,
      reply_full TEXT NOT NULL,
      reply_saved TEXT NOT NULL,
      targets TEXT NOT NULL,
      held_at INTEGER NOT NULL,
      state TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS fork_bot_room_hop_holds_state
      ON fork_bot_room_hop_holds(state, root_request_id);`)
  prepared.add(db)
}

function holdRow(row: Record<string, unknown>): BotRoomHopHold {
  const targets: unknown = JSON.parse(String(row.targets))
  return {
    operationId: String(row.operation_id),
    messageId: String(row.message_id),
    groupId: String(row.group_id),
    threadId: row.thread_id === null ? null : String(row.thread_id),
    rootRequestId: String(row.root_request_id),
    rootSequence: Number(row.root_sequence),
    heldAfter: Number(row.held_after),
    hop: Number(row.hop),
    replyFull: String(row.reply_full),
    replySaved: String(row.reply_saved),
    targets: Array.isArray(targets) ? targets.map(String) : [],
    heldAt: Number(row.held_at),
    state: holdState(row.state)
  }
}

const STATES: readonly BotRoomHopHoldState[] = [
  'held',
  'continuing',
  'continued',
  'dismissed',
  'moot'
]

function holdState(value: unknown): BotRoomHopHoldState {
  return STATES.find((state) => state === value) ?? 'moot'
}

export function readBotRoomHopHold(db: Database, operationId: string): BotRoomHopHold | null {
  ensureTable(db)
  const row = db
    .prepare('SELECT * FROM fork_bot_room_hop_holds WHERE operation_id = ?')
    .get(operationId)
  return row ? holdRow(row) : null
}

/** Saves a held hand-off; a replay of the same turn keeps the first. */
export function saveBotRoomHopHold(db: Database, hold: Omit<BotRoomHopHold, 'state'>): void {
  ensureTable(db)
  db.prepare(
    `INSERT OR IGNORE INTO fork_bot_room_hop_holds (operation_id, message_id, group_id, thread_id,
       root_request_id, root_sequence, held_after, hop, reply_full, reply_saved, targets, held_at,
       state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'held')`
  ).run(
    hold.operationId,
    hold.messageId,
    hold.groupId,
    hold.threadId,
    hold.rootRequestId,
    hold.rootSequence,
    hold.heldAfter,
    hold.hop,
    hold.replyFull,
    hold.replySaved,
    JSON.stringify(hold.targets),
    hold.heldAt
  )
}

/** Every hold in `state` (held: still waiting on the owner), oldest first; one group's when given. */
export function heldBotRoomHops(
  db: Database,
  groupId?: string,
  state: BotRoomHopHoldState = 'held'
): BotRoomHopHold[] {
  ensureTable(db)
  const rows =
    groupId === undefined
      ? db
          .prepare('SELECT * FROM fork_bot_room_hop_holds WHERE state = ? ORDER BY held_at, rowid')
          .all(state)
      : db
          .prepare(
            'SELECT * FROM fork_bot_room_hop_holds WHERE state = ? AND group_id = ? ORDER BY held_at, rowid'
          )
          .all(state, groupId)
  return rows.map(holdRow)
}

/** Moves one hold from `from` (held) to `state`; false when it was not there (a second Continue, a
 *  race). */
export function settleBotRoomHopHold(
  db: Database,
  operationId: string,
  state: BotRoomHopHoldState,
  from: BotRoomHopHoldState = 'held'
): boolean {
  ensureTable(db)
  return (
    db
      .prepare('UPDATE fork_bot_room_hop_holds SET state = ? WHERE operation_id = ? AND state = ?')
      .run(state, operationId, from).changes === 1
  )
}

/** Drops the holds of rooms that are gone: a removed room takes its holds with it. */
export function pruneBotRoomHopHolds(db: Database): boolean {
  ensureTable(db)
  return (
    Number(
      db
        .prepare(
          'DELETE FROM fork_bot_room_hop_holds WHERE group_id NOT IN (SELECT id FROM bot_groups)'
        )
        .run().changes
    ) > 0
  )
}

const HANDOFF_PREFIX = 'handoff:'

/** The operation of the member turn whose reply woke this hand-off line; null for any other line. */
export function handOffSpeakerOperation(line: BotGroupMessage): string | null {
  const woken = line.turns[0]?.botId
  const suffix = `:${woken}`
  if (
    line.mentioned !== true ||
    woken === undefined ||
    !line.id.startsWith(HANDOFF_PREFIX) ||
    !line.id.endsWith(suffix)
  ) {
    return null
  }
  const operationId = line.id.slice(HANDOFF_PREFIX.length, -suffix.length)
  return operationId || null
}

/** The latest hand-off line under `root` stored before `sequence`. */
function latestHandOffBefore(
  store: BotGroupStore,
  groupId: string,
  rootRequestId: string,
  sequence: number
): BotGroupMessage | null {
  const row = store.db
    .prepare(
      `SELECT id FROM bot_group_messages WHERE group_id = ? AND sequence < ? AND id LIKE 'handoff:%'
         AND json_extract(record, '$.rootRequestId') = ? ORDER BY sequence DESC LIMIT 1`
    )
    .get(groupId, sequence, rootRequestId)
  return row ? store.message(String(row.id)) : null
}

/**
 * How many hand-offs lead from the request to `line`: 0 for the person's post (or any line that
 * starts a request), one more per hand-off line up the chain. One reply naming several members
 * wakes them all at the same depth. A hand-off the owner let go on starts a fresh count at 1. A
 * mail line (a peer reply, a worker report) adds no hop: it carries on from the latest hand-off
 * under its request.
 */
export function botRoomHandOffDepth(store: BotGroupStore, line: BotGroupMessage): number {
  let depth = 0
  const seen = new Set<string>()
  for (let at: BotGroupMessage | null = line; at && !seen.has(at.id);) {
    seen.add(at.id)
    if (startsBotGroupRequest(at) || !at.rootRequestId || at.id === at.rootRequestId) {
      return depth
    }
    const speaker = handOffSpeakerOperation(at)
    if (!speaker) {
      at = latestHandOffBefore(store, at.groupId, at.rootRequestId, at.sequence)
      continue
    }
    depth += 1
    if (botRoomHopHoldLetGo(readBotRoomHopHold(store.db, speaker))) {
      return depth
    }
    at = store.operationMessage(speaker)
  }
  return depth
}

/** Whether a request line (a person's post, or one that starts a request of its own) was stored
 *  in the room after `sequence`. */
export function requestLineAfter(
  store: BotGroupStore,
  groupId: string,
  threadId: string | null,
  sequence: number
): boolean {
  const rows = store.db
    .prepare(
      `SELECT id FROM bot_group_messages WHERE group_id = ? AND sequence > ?
         AND coalesce(json_extract(record, '$.threadId'), '') = ?
         AND (json_extract(record, '$.author.kind') = 'owner'
           OR json_extract(record, '$.fromItems') IS NOT NULL
           OR json_extract(record, '$.fromReports') IS NOT NULL)`
    )
    .all(groupId, sequence, threadId ?? '')
  return rows.some((row) => {
    const message = store.message(String(row.id))
    return message !== null && startsBotGroupRequest(message)
  })
}
