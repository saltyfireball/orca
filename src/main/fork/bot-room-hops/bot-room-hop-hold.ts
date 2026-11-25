// Bot room hop limit (BAD-801, FORK.md "Bot room hop limit"): the check `handOffGroupMentions`
// makes before it wakes the members a reply names. Past the limit it wakes nobody and saves the
// hand-off for the owner's Continue; the reply itself stays in the room.
import type { BotGroupMessage, BotGroupTurn } from '../../../shared/bots/bot-group'
import { forkBotRoomHopLimit } from '../../../shared/fork/bot-room-hops'
import type { BotGroupRuntime } from '../../bots/bot-group-runtime'
import { notifyForkInboxSourceChanged } from '../idle-recovery/idle-recovery-sources'
import {
  botRoomHandOffDepth,
  botRoomHopHoldLetGo,
  readBotRoomHopHold,
  saveBotRoomHopHold
} from './bot-room-hop-store'

function hopLimit(groups: BotGroupRuntime): number {
  try {
    return forkBotRoomHopLimit(groups.runtime.requireStore().getSettings())
  } catch {
    // No settings store (a headless start): the default still guards the room.
    return forkBotRoomHopLimit(undefined)
  }
}

/** True when this turn's hand-off to `targets` is past the limit and was held instead; called in
 *  the room's queue, with the turn not yet handed off. A hold the owner continued passes once. */
export function forkHoldsBotRoomHandOff(
  groups: BotGroupRuntime,
  message: BotGroupMessage,
  turn: BotGroupTurn,
  reply: { full: string; saved: string },
  targets: readonly string[]
): boolean {
  const limit = hopLimit(groups)
  if (limit === 0) {
    return false
  }
  const { db } = groups.store
  const saved = readBotRoomHopHold(db, turn.operationId)
  if (saved) {
    return !botRoomHopHoldLetGo(saved)
  }
  const hop = botRoomHandOffDepth(groups.store, message) + 1
  if (hop <= limit) {
    return false
  }
  saveBotRoomHopHold(db, {
    operationId: turn.operationId,
    messageId: message.id,
    groupId: message.groupId,
    threadId: message.threadId ?? null,
    rootRequestId: message.rootRequestId ?? message.id,
    rootSequence: message.rootSequence ?? message.sequence,
    heldAfter: groups.store.messages(message.groupId, 1)[0]?.sequence ?? message.sequence,
    hop,
    replyFull: reply.full,
    replySaved: reply.saved,
    targets: [...targets],
    heldAt: Date.now()
  })
  notifyForkInboxSourceChanged()
  return true
}
