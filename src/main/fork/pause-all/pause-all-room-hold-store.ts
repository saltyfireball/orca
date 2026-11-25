// Pause all over bot room hand-offs (BAD-818, FORK.md "Pause all"): the check `handOffGroupMentions`
// makes before it wakes the members a reply names. While the switch is engaged (or unreadable) it
// wakes nobody and saves the hand-off beside the room store, so a restart keeps it, and the
// speaker's chat says why. `pause-all-room-release.ts` lets each go on once at resume-all.
import type { BotGroupMessage, BotGroupTurn } from '../../../shared/bots/bot-group'
import type { BotGroupRuntime } from '../../bots/bot-group-runtime'
import { writeInChat } from '../../bots/bot-chat-status-line'
import type Database from '../../sqlite/sync-database'
import { botRoomHopHoldLetGo, readBotRoomHopHold } from '../bot-room-hops/bot-room-hop-store'
import { forkPauseAllRefusal } from './pause-all-state'

/** held: waiting for resume-all. releasing: claimed by a release whose wake has not settled (a
 *  restart settles it). released: it went on once. dropped: its room line is gone. */
export type PauseAllRoomHoldState = 'held' | 'releasing' | 'released' | 'dropped'
const STATES: readonly PauseAllRoomHoldState[] = ['held', 'releasing', 'released', 'dropped']

export type PauseAllRoomHold = {
  operationId: string
  messageId: string
  groupId: string
  replyFull: string
  replySaved: string
  heldAt: number
}

const prepared = new WeakSet<Database>()

function ensureTable(db: Database): void {
  if (prepared.has(db)) {
    return
  }
  db.exec(`CREATE TABLE IF NOT EXISTS fork_pause_all_room_holds (
      operation_id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      reply_full TEXT NOT NULL,
      reply_saved TEXT NOT NULL,
      held_at INTEGER NOT NULL,
      state TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS fork_pause_all_room_holds_state
      ON fork_pause_all_room_holds(state, held_at);`)
  prepared.add(db)
}

function roomHoldState(db: Database, operationId: string): PauseAllRoomHoldState | null {
  ensureTable(db)
  const row = db
    .prepare('SELECT state FROM fork_pause_all_room_holds WHERE operation_id = ?')
    .get(operationId)
  // An unknown state reads as released: it never holds a turn for good.
  return row ? (STATES.find((state) => state === row.state) ?? 'released') : null
}

/** Every hold in `state`, oldest first. */
export function pauseAllRoomHolds(db: Database, state: PauseAllRoomHoldState): PauseAllRoomHold[] {
  ensureTable(db)
  return db
    .prepare('SELECT * FROM fork_pause_all_room_holds WHERE state = ? ORDER BY held_at, rowid')
    .all(state)
    .map((row) => ({
      operationId: String(row.operation_id),
      messageId: String(row.message_id),
      groupId: String(row.group_id),
      replyFull: String(row.reply_full),
      replySaved: String(row.reply_saved),
      heldAt: Number(row.held_at)
    }))
}

/** Moves one hold from `from` to `to`; false when it was not there (a second release, a race). */
export function settlePauseAllRoomHold(
  db: Database,
  operationId: string,
  to: PauseAllRoomHoldState,
  from: PauseAllRoomHoldState
): boolean {
  ensureTable(db)
  return (
    db
      .prepare(
        'UPDATE fork_pause_all_room_holds SET state = ? WHERE operation_id = ? AND state = ?'
      )
      .run(to, operationId, from).changes === 1
  )
}

/** Room hand-offs waiting for resume-all on this host. */
export function countPauseAllRoomHolds(db: Database): number {
  return pauseAllRoomHolds(db, 'held').length
}

/** True when this turn's hand-off to `targets` was held for resume-all instead; called in the
 *  room's queue with the turn not yet handed off. A hold being released passes. */
export function forkPauseAllHoldsRoomHandOff(
  groups: BotGroupRuntime,
  message: BotGroupMessage,
  turn: BotGroupTurn,
  reply: { full: string; saved: string },
  targets: readonly string[]
): boolean {
  const { db } = groups.store
  const saved = roomHoldState(db, turn.operationId)
  if (saved !== null) {
    return saved === 'held'
  }
  const reason = forkPauseAllRefusal()
  // The owner's Continue of a hop-limit hold is a person asking.
  if (reason === null || botRoomHopHoldLetGo(readBotRoomHopHold(db, turn.operationId))) {
    return false
  }
  db.prepare(
    `INSERT OR IGNORE INTO fork_pause_all_room_holds (operation_id, message_id, group_id,
       reply_full, reply_saved, held_at, state) VALUES (?, ?, ?, ?, ?, ?, 'held')`
  ).run(turn.operationId, message.id, message.groupId, reply.full, reply.saved, Date.now())
  const bots = groups.runtime.bots.list()
  const names = targets.map((id) => bots.find((bot) => bot.id === id)?.name ?? id)
  writeInChat(
    turn.sessionId,
    {
      kind: 'status',
      text: `${reason} ${turn.botName}'s hand-off to ${names.join(', ')} is held and goes on once at resume-all.`
    },
    'pause-all'
  )
  console.info('[fork-pause-all] a bot room hand-off is held', {
    operationId: turn.operationId,
    groupId: message.groupId
  })
  return true
}
