// Bot room hop limit (BAD-801, FORK.md "Bot room hop limit"): the hand-offs held at the limit, kept
// beside the room store in its own database so a restart keeps them, and how deep a room line sits
// in its chain of hand-offs, read from the stored lines themselves. Only a person's post starts a
// count (BAD-844): a line agents made (an item change, a late worker report) carries on the chain.
import type Database from '../../sqlite/sync-database'
import type { BotGroupMessage } from '../../../shared/bots/bot-group-schema'
import type { BotGroupStore } from '../../bots/bot-group-store'

/** held: waiting on the owner. continuing: claimed by a Continue whose wake has not finished (a
 *  restart settles it). continued: the owner's Continue let it go on once. dismissed: the owner left
 *  the room as it was. moot: a later person post or a Stop ended the chain. */
export type BotRoomHopHoldState = 'held' | 'continuing' | 'continued' | 'dismissed' | 'moot'

/** Which limit held it: the chain's depth (forkBotRoomHopLimit) or the post's woken turns
 *  (forkBotRoomTurnCap, BAD-844). */
export type BotRoomHopHeldBy = 'hops' | 'turns'

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
  /** The person's post the chain runs under, which names its inbox entry. */
  rootRequestId: string
  /** The sequence of the request the held line serves, which a Stop ends. */
  rootSequence: number
  /** The room's newest sequence when it was held; a request line past it makes the hold moot. */
  heldAfter: number
  /** The hop the hand-off would have been. */
  hop: number
  heldBy: BotRoomHopHeldBy
  /** The turns the post had woken since its count started, when it was held. */
  woken: number
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
  // Added by BAD-844 to tables BAD-801 made.
  const columns = new Set(
    db
      .prepare('PRAGMA table_info(fork_bot_room_hop_holds)')
      .all()
      .map((row) => String(row.name))
  )
  if (!columns.has('held_by')) {
    db.exec('ALTER TABLE fork_bot_room_hop_holds ADD COLUMN held_by TEXT')
  }
  if (!columns.has('woken')) {
    db.exec('ALTER TABLE fork_bot_room_hop_holds ADD COLUMN woken INTEGER')
  }
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
    heldBy: row.held_by === 'turns' ? 'turns' : 'hops',
    woken: Number(row.woken ?? 0),
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
       root_request_id, root_sequence, held_after, hop, held_by, woken, reply_full, reply_saved,
       targets, held_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'held')`
  ).run(
    hold.operationId,
    hold.messageId,
    hold.groupId,
    hold.threadId,
    hold.rootRequestId,
    hold.rootSequence,
    hold.heldAfter,
    hold.hop,
    hold.heldBy,
    hold.woken,
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

/** The latest hand-off line stored before `sequence` in `line`'s room and thread; under its own
 *  request when it has one, under any otherwise (a line agents made carries on the room's chain). */
function latestHandOffBefore(store: BotGroupStore, line: BotGroupMessage): BotGroupMessage | null {
  const row = line.rootRequestId
    ? store.db
        .prepare(
          `SELECT id FROM bot_group_messages WHERE group_id = ? AND sequence < ? AND id LIKE 'handoff:%'
             AND json_extract(record, '$.rootRequestId') = ? ORDER BY sequence DESC LIMIT 1`
        )
        .get(line.groupId, line.sequence, line.rootRequestId)
    : store.db
        .prepare(
          `SELECT id FROM bot_group_messages WHERE group_id = ? AND sequence < ? AND id LIKE 'handoff:%'
             AND coalesce(json_extract(record, '$.threadId'), '') = ?
           ORDER BY sequence DESC LIMIT 1`
        )
        .get(line.groupId, line.sequence, line.threadId ?? '')
  return row ? store.message(String(row.id)) : null
}

/**
 * How many hand-offs lead from the person's post to `line`: 0 for the post, one more per hand-off
 * line up the chain. One reply naming several members wakes them all at the same depth. A hand-off
 * the owner let go on starts a fresh count at 1. A mail line (a peer reply, a worker report) adds
 * no hop: it carries on from the latest hand-off under its request. A line agents made that serves
 * no post (an item change, a late worker report) carries on from the room's latest hand-off.
 */
export function botRoomHandOffDepth(store: BotGroupStore, line: BotGroupMessage): number {
  let depth = 0
  const seen = new Set<string>()
  for (let at: BotGroupMessage | null = line; at && !seen.has(at.id);) {
    seen.add(at.id)
    if (at.author.kind === 'owner') {
      return depth
    }
    const speaker = handOffSpeakerOperation(at)
    if (!speaker) {
      at =
        latestHandOffBefore(store, at) ??
        (at.rootRequestId && at.rootRequestId !== at.id ? store.message(at.rootRequestId) : null)
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

/** The latest person's post in `groupId`'s `threadId` stored before `sequence`. */
function personPostBefore(
  store: BotGroupStore,
  groupId: string,
  threadId: string | undefined,
  sequence: number
): BotGroupMessage | null {
  const row = store.db
    .prepare(
      `SELECT id FROM bot_group_messages WHERE group_id = ? AND sequence < ?
         AND coalesce(json_extract(record, '$.threadId'), '') = ?
         AND json_extract(record, '$.author.kind') = 'owner' ORDER BY sequence DESC LIMIT 1`
    )
    .get(groupId, sequence, threadId ?? '')
  const post = row ? store.message(String(row.id)) : null
  return post?.author.kind === 'owner' ? post : null
}

/** The person's post `line`'s chain runs under: its request when a person wrote it, else (a line
 *  agents made, or one whose request cannot be read) the person's post before that request. */
export function botRoomPersonPost(
  store: BotGroupStore,
  line: BotGroupMessage
): { id: string; sequence: number } {
  const rootId = line.rootRequestId ?? line.id
  const root = rootId === line.id ? line : store.message(rootId)
  if (root?.author.kind === 'owner') {
    return { id: root.id, sequence: root.sequence }
  }
  const sequence = root?.sequence ?? line.rootSequence ?? line.sequence
  const post = personPostBefore(store, line.groupId, line.threadId, sequence)
  return post ? { id: post.id, sequence: post.sequence } : { id: rootId, sequence }
}

/** The members woken by hand-offs under `post` after `since` (its own sequence or later). */
export function botRoomWokenTurns(
  store: BotGroupStore,
  line: Pick<BotGroupMessage, 'groupId' | 'threadId'>,
  post: { id: string; sequence: number },
  since: number
): number {
  const rows = store.db
    .prepare(
      `SELECT id FROM bot_group_messages WHERE group_id = ? AND sequence > ? AND id LIKE 'handoff:%'
         AND coalesce(json_extract(record, '$.threadId'), '') = ?`
    )
    .all(line.groupId, Math.max(post.sequence, since), line.threadId ?? '')
  const postOf = new Map<string, string>()
  return rows.filter((row) => {
    const woken = store.message(String(row.id))
    if (!woken) {
      return false
    }
    const rootId = woken.rootRequestId ?? woken.id
    let id = postOf.get(rootId)
    if (id === undefined) {
      id = botRoomPersonPost(store, woken).id
      postOf.set(rootId, id)
    }
    return id === post.id
  }).length
}

/** Where `post`'s woken-turn count starts: after the last hold the owner let go on, or 0. */
export function botRoomTurnCountStart(db: Database, postId: string): number {
  ensureTable(db)
  const row = db
    .prepare(
      `SELECT max(held_after) AS since FROM fork_bot_room_hop_holds
         WHERE root_request_id = ? AND state IN ('continuing', 'continued')`
    )
    .get(postId)
  return Number(row?.since ?? 0)
}

/** Whether a person's post was stored in the room after `sequence`. A line agents made (an item
 *  change, a late worker report) carries on a chain, so it does not count. */
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
         AND json_extract(record, '$.author.kind') = 'owner'`
    )
    .all(groupId, sequence, threadId ?? '')
  return rows.some((row) => store.message(String(row.id))?.author.kind === 'owner')
}
