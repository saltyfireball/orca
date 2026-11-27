// Bot room hop limit (BAD-801, FORK.md "Bot room hop limit"): the check `handOffGroupMentions`
// makes before it wakes the members a reply names. Past the hop limit, or (BAD-844) past the cap
// on turns woken under the person's post, it wakes nobody and saves the hand-off for the owner's
// Continue; the reply itself stays in the room.
import type { BotGroupMessage, BotGroupTurn } from '../../../shared/bots/bot-group'
import { forkBotRoomHopLimit, forkBotRoomTurnCap } from '../../../shared/fork/bot-room-hops'
import type { BotGroupRuntime } from '../../bots/bot-group-runtime'
import { notifyForkInboxSourceChanged } from '../idle-recovery/idle-recovery-sources'
import {
  botRoomHandOffDepth,
  botRoomHopHoldLetGo,
  botRoomPersonPost,
  botRoomTurnCountStart,
  botRoomWokenTurns,
  readBotRoomHopHold,
  saveBotRoomHopHold
} from './bot-room-hop-store'

function roomLimits(groups: BotGroupRuntime): { hops: number; turns: number } {
  let settings: unknown
  try {
    settings = groups.runtime.requireStore().getSettings()
  } catch {
    // No settings store (a headless start): the defaults still guard the room.
  }
  return { hops: forkBotRoomHopLimit(settings), turns: forkBotRoomTurnCap(settings) }
}

/** True when this turn's hand-off to `targets` is past a limit and was held instead; called in
 *  the room's queue, with the turn not yet handed off. A hold the owner continued passes once. */
export function forkHoldsBotRoomHandOff(
  groups: BotGroupRuntime,
  message: BotGroupMessage,
  turn: BotGroupTurn,
  reply: { full: string; saved: string },
  targets: readonly string[]
): boolean {
  const limits = roomLimits(groups)
  if (limits.hops === 0 && limits.turns === 0) {
    return false
  }
  const { db } = groups.store
  const saved = readBotRoomHopHold(db, turn.operationId)
  if (saved) {
    return !botRoomHopHoldLetGo(saved)
  }
  const hop = botRoomHandOffDepth(groups.store, message) + 1
  const post = botRoomPersonPost(groups.store, message)
  const woken =
    limits.turns === 0
      ? 0
      : botRoomWokenTurns(groups.store, message, post, botRoomTurnCountStart(db, post.id))
  const pastHops = limits.hops > 0 && hop > limits.hops
  const pastTurns = limits.turns > 0 && woken + targets.length > limits.turns
  if (!pastHops && !pastTurns) {
    return false
  }
  saveBotRoomHopHold(db, {
    operationId: turn.operationId,
    messageId: message.id,
    groupId: message.groupId,
    threadId: message.threadId ?? null,
    rootRequestId: post.id,
    rootSequence: message.rootSequence ?? message.sequence,
    heldAfter: groups.store.messages(message.groupId, 1)[0]?.sequence ?? message.sequence,
    hop,
    heldBy: pastHops ? 'hops' : 'turns',
    woken,
    replyFull: reply.full,
    replySaved: reply.saved,
    targets: [...targets],
    heldAt: Date.now()
  })
  notifyForkInboxSourceChanged()
  return true
}
