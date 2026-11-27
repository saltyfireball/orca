// Bot room hop limit (BAD-801, FORK.md "Bot room hop limit"): a chain held at the limit as one
// Decision inbox entry per person post, with the last exchange. Continue lets each held hand-off
// go on once with a fresh count; Dismiss leaves the room as it is. A later person post in the room,
// or a Stop of every member it would wake, makes the entry moot and takes it off.
import type { BotGroupTurn } from '../../../shared/bots/bot-group'
import type {
  ForkIdleRecoveryAnswerOutcome,
  ForkIdleRecoveryInboxItem
} from '../../../shared/fork/idle-recovery-wire'
import { runKeyedSerializedOperation } from '../../../shared/concurrency/keyed-serialized-operations'
import { handOffGroupMentions } from '../../bots/bot-group-mention-handoffs'
import type { BotGroupRuntime } from '../../bots/bot-group-runtime'
import {
  notifyForkInboxSourceChanged,
  registerForkInboxSource
} from '../idle-recovery/idle-recovery-sources'
import {
  handOffSpeakerOperation,
  heldBotRoomHops,
  pruneBotRoomHopHolds,
  requestLineAfter,
  settleBotRoomHopHold,
  type BotRoomHopHold
} from './bot-room-hop-store'

export const BOT_ROOM_HOP_ROW_PREFIX = 'hops:'
const EXCERPT_CHARS = 400

/** Lists this host's held chains in the Decision inbox; the newest runtime wins (one per host). A
 *  Continue the app stopped in the middle of is settled first, and removed rooms' holds dropped. */
export function installForkBotRoomHops(groups: BotGroupRuntime): void {
  try {
    pruneBotRoomHopHolds(groups.store.db)
    for (const hold of heldBotRoomHops(groups.store.db, undefined, 'continuing')) {
      settleContinuing(groups, hold, wokeAny(groups, hold))
    }
  } catch (error) {
    console.warn('[fork bot room hops] could not settle held hand-offs at start', error)
  }
  registerForkInboxSource({
    id: 'hops',
    items: async () => botRoomHopInboxItems(groups),
    answer: (chatId) => continueBotRoomHops(groups, chatId),
    dismiss: async (chatId) => dismissBotRoomHops(groups, chatId)
  })
}

function isMoot(groups: BotGroupRuntime, hold: BotRoomHopHold): boolean {
  const { store } = groups
  let members
  try {
    members = store.room(hold.groupId, hold.threadId ?? undefined).members
  } catch {
    return true
  }
  if (!store.message(hold.messageId)) {
    return true
  }
  if (requestLineAfter(store, hold.groupId, hold.threadId, hold.heldAfter)) {
    return true
  }
  // A person's Stop after the post holds a member, so Continue would wake none of them.
  return hold.targets.every((botId) => {
    const member = members.find((candidate) => candidate.botId === botId)
    return !member || (member.stoppedThroughSequence ?? 0) >= hold.rootSequence
  })
}

/** Takes off the holds a later post or a Stop made moot (one group's, when given); true when any. */
export function settleMootBotRoomHops(groups: BotGroupRuntime, groupId?: string): boolean {
  let settled = false
  for (const hold of heldBotRoomHops(groups.store.db, groupId)) {
    if (isMoot(groups, hold) && settleBotRoomHopHold(groups.store.db, hold.operationId, 'moot')) {
      settled = true
    }
  }
  if (settled) {
    notifyForkInboxSourceChanged()
  }
  return settled
}

/** The room changed (a post, a Stop, a removal): an entry it made moot leaves the inbox now. */
export function forkBotRoomHopsChanged(groups: BotGroupRuntime, groupId?: string): void {
  try {
    // A room's removal tells every reader (no group id).
    if (groupId === undefined && pruneBotRoomHopHolds(groups.store.db)) {
      notifyForkInboxSourceChanged()
    }
    settleMootBotRoomHops(groups, groupId)
  } catch (error) {
    console.warn('[fork bot room hops] could not settle held hand-offs', error)
  }
}

function heldByRoot(groups: BotGroupRuntime): Map<string, BotRoomHopHold[]> {
  settleMootBotRoomHops(groups)
  return Map.groupBy(heldBotRoomHops(groups.store.db), (hold) => hold.rootRequestId)
}

function excerpt(text: string | null | undefined): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > EXCERPT_CHARS ? `${flat.slice(0, EXCERPT_CHARS)}...` : flat
}

function heldTurn(groups: BotGroupRuntime, hold: BotRoomHopHold): BotGroupTurn | undefined {
  return groups.store
    .message(hold.messageId)
    ?.turns.find((turn) => turn.operationId === hold.operationId)
}

/** The reply that woke the held speaker (when a hand-off did), then the speaker's own. */
function lastExchange(groups: BotGroupRuntime, hold: BotRoomHopHold, speaker: string): string[] {
  const line = groups.store.message(hold.messageId)
  const wakerOperation = line ? handOffSpeakerOperation(line) : null
  const waker = wakerOperation
    ? groups.store
        .operationMessage(wakerOperation)
        ?.turns.find((turn) => turn.operationId === wakerOperation)
    : undefined
  return [
    ...(waker ? [`${waker.botName}: ${excerpt(waker.reply)}`] : []),
    `${speaker}: ${excerpt(hold.replySaved || hold.replyFull)}`
  ]
}

/** Who each held reply named, one entry per held exchange: speaker and the bots it named. */
function heldExchanges(
  groups: BotGroupRuntime,
  holds: BotRoomHopHold[]
): { speaker: string; named: string[] }[] {
  const bots = groups.runtime.bots.list()
  const nameOf = (id: string): string => bots.find((bot) => bot.id === id)?.name ?? id
  return holds.map((hold) => ({
    speaker: heldTurn(groups, hold)?.botName ?? 'A bot',
    named: hold.targets.map(nameOf)
  }))
}

/** "Ada named Bo", one clause per held exchange; two bots holding each other say so once. */
function describeHeld(exchanges: { speaker: string; named: string[] }[]): string {
  const pairs = new Set(exchanges.map((e) => e.speaker))
  const solo = exchanges.every((e) => e.named.length === 1)
  if (solo && pairs.size === 2 && exchanges.length >= 2) {
    const [a, b] = [...pairs].sort()
    if (exchanges.every((e) => e.named[0] === (e.speaker === a ? b : a))) {
      return `${a} and ${b} kept naming each other`
    }
  }
  const clauses = [...new Set(exchanges.map((e) => `${e.speaker} named ${e.named.join(', ')}`))]
  return clauses.join('; ')
}

function inboxItem(groups: BotGroupRuntime, holds: BotRoomHopHold[]): ForkIdleRecoveryInboxItem {
  const first = holds[0]!
  const last = holds.at(-1)!
  const exchanges = heldExchanges(groups, holds)
  const speaker = exchanges.at(-1)!.speaker
  const speakers = [...new Set(exchanges.map((e) => e.speaker))].join(' and ')
  let room = 'A bot room'
  try {
    room = groups.store.get(last.groupId).name
  } catch {
    // The group went; isMoot takes the entry off on the next read.
  }
  const hops = last.hop - 1
  const held = holds.length > 1 ? ` ${holds.length} replies were held.` : ''
  const goOn = holds.length > 1 ? 'lets each chain go on' : 'lets the chain go on'
  return {
    chatId: `${BOT_ROOM_HOP_ROW_PREFIX}${last.rootRequestId}`,
    kind: 'chat',
    agent: speakers,
    title: `${room}: bots stopped after ${hops} hand-offs`,
    workspace: '',
    worktreeId: null,
    verdict: 'waiting_user',
    question: [
      `${describeHeld(exchanges)} after ${hops} bot hand-offs under one post, so nobody was woken.${held} Continue ${goOn} with a fresh count; Dismiss leaves the room as it is.`,
      '',
      'Last exchange:',
      ...lastExchange(groups, last, speaker)
    ].join('\n'),
    reason: '',
    since: first.heldAt,
    wakes: 0,
    wakeAt: null,
    paused: false,
    source: 'hops'
  }
}

export function botRoomHopInboxItems(groups: BotGroupRuntime): ForkIdleRecoveryInboxItem[] {
  return [...heldByRoot(groups).values()].map((holds) => inboxItem(groups, holds))
}

function holdsOf(groups: BotGroupRuntime, chatId: string): BotRoomHopHold[] | null {
  if (!chatId.startsWith(BOT_ROOM_HOP_ROW_PREFIX)) {
    return null
  }
  return heldByRoot(groups).get(chatId.slice(BOT_ROOM_HOP_ROW_PREFIX.length)) ?? []
}

/** Whether the hold's turn woke anyone: its hand-off lines commit with the turn's marker. */
function wokeAny(groups: BotGroupRuntime, hold: BotRoomHopHold): boolean {
  const turn = heldTurn(groups, hold)
  return (turn?.handedOff ?? []).some((botId) =>
    groups.store.message(`handoff:${hold.operationId}:${botId}`)
  )
}

/** Ends a Continue: `done` makes it continued; otherwise the hold is back on the inbox, its turn
 *  marked handed off to no one again so a replayed end wakes nobody. */
function settleContinuing(groups: BotGroupRuntime, hold: BotRoomHopHold, done: boolean): void {
  const { store } = groups
  if (done) {
    settleBotRoomHopHold(store.db, hold.operationId, 'continued', 'continuing')
    return
  }
  store.transaction(() => {
    const message = store.message(hold.messageId)
    if (message) {
      store.update({
        ...message,
        turns: message.turns.map((turn) =>
          turn.operationId === hold.operationId && turn.handedOff === undefined
            ? { ...turn, handedOff: [] }
            : turn
        )
      })
    }
    settleBotRoomHopHold(store.db, hold.operationId, 'held', 'continuing')
  })
}

/** The owner's Continue (any answer to the entry): each held hand-off of the post wakes the
 *  members its reply named, as it would have, and the chain counts afresh from there. */
export async function continueBotRoomHops(
  groups: BotGroupRuntime,
  chatId: string
): Promise<ForkIdleRecoveryAnswerOutcome | null> {
  const holds = holdsOf(groups, chatId)
  if (holds === null) {
    return null
  }
  let continued = 0
  for (const hold of holds) {
    // Claimed first, so a second Continue or a racing one resumes nothing twice. A restart before
    // it settles puts it back on the inbox unless its wake was stored (installForkBotRoomHops).
    if (!settleBotRoomHopHold(groups.store.db, hold.operationId, 'continuing')) {
      continue
    }
    continued += 1
    await runKeyedSerializedOperation(groups.queues, hold.groupId, async () => {
      const message = groups.store.message(hold.messageId)
      if (message) {
        groups.store.update({
          ...message,
          turns: message.turns.map(({ handedOff, ...turn }) =>
            turn.operationId === hold.operationId ? turn : { ...turn, handedOff }
          )
        })
      }
    })
    const message = groups.store.message(hold.messageId)
    const turn = message?.turns.find((candidate) => candidate.operationId === hold.operationId)
    let done = false
    if (message && turn) {
      done = await handOffGroupMentions(groups, message, turn, {
        full: hold.replyFull,
        saved: hold.replySaved
      }).then(
        () => true,
        (error: unknown) => {
          console.warn('[fork bot room hops] a continued hand-off failed', error)
          return false
        }
      )
    }
    await runKeyedSerializedOperation(groups.queues, hold.groupId, async () =>
      settleContinuing(groups, hold, done)
    )
  }
  notifyForkInboxSourceChanged()
  return continued > 0 ? 'sent' : 'not-waiting'
}

function dismissBotRoomHops(groups: BotGroupRuntime, chatId: string): boolean {
  const holds = holdsOf(groups, chatId) ?? []
  return (
    holds.filter((hold) => settleBotRoomHopHold(groups.store.db, hold.operationId, 'dismissed'))
      .length > 0
  )
}
