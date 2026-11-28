// Bot room hop limit (BAD-801): each reply arrives the way a member chat's end brings it
// (noteBotGroupMemberReply reading the chat's journal), and the count, the held entry and a
// Continue cut short by a quit all survive closing the database and building a new runtime.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BotGroupMessage } from '../../../shared/bots/bot-group'
import SyncDatabase from '../../sqlite/sync-database'
import { noteBotGroupMemberReply } from '../../bots/bot-group-latest'
import { handOffGroupMentions } from '../../bots/bot-group-mention-handoffs'
import { setStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import type { StructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-host'
import {
  answerFromInboxSource,
  resetForkInboxSourcesForTests
} from '../idle-recovery/idle-recovery-sources'
import { readBotRoomHopHold, settleBotRoomHopHold } from './bot-room-hop-store'
import { pingPong, room, type Room } from './bot-room-hops-test-room'

type Ended = { operationId: string; text: string }

/** Each member chat's journal: the turns that ended, by turn id. */
const journals = new Map<string, Map<string, Ended>>()

function snapshotOf(sessionId: string, turnIds: readonly string[]) {
  const ended = turnIds.flatMap((turnId) => {
    const turn = journals.get(sessionId)?.get(turnId)
    return turn ? [{ turnId, ...turn }] : []
  })
  return {
    items: ended.flatMap(({ turnId, text }) => [
      { itemId: `turn-${turnId}`, body: { kind: 'turn', turnId, state: 'completed' } },
      {
        itemId: `reply-${turnId}`,
        turnScope: { kind: 'turn', turnItemId: `turn-${turnId}` },
        body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text }] }
      }
    ]),
    submissions: ended.map(({ turnId, operationId }) => ({
      clientMessageId: operationId,
      dispatchState: 'accepted',
      answeredInTurn: { turnItemId: `turn-${turnId}` }
    }))
  }
}

const host = {
  journalReads: async (sessionId: string) => ({
    // The woken turn reached its chat; its end comes through `memberEnds`.
    operationSent: async () => true,
    operationWindow: async ({ turnIds }: { turnIds: string[] }) => ({
      snapshot: snapshotOf(sessionId, turnIds)
    })
  })
}

/** `botId`'s chat ends its turn on `lineId` with `text`, and the room hears of it as it does from a
 *  member chat: noteBotGroupMemberReply reads the reply from the journal and hands off. */
async function memberEnds(
  r: Room,
  lineId: string,
  botId: string,
  text: string
): Promise<BotGroupMessage[]> {
  const turn = r.groups.store.message(lineId)!.turns.find((candidate) => candidate.botId === botId)!
  const turnId = `t-${turn.operationId}`
  const journal = journals.get(turn.sessionId) ?? new Map<string, Ended>()
  journal.set(turnId, { operationId: turn.operationId, text })
  journals.set(turn.sessionId, journal)
  await noteBotGroupMemberReply(r.runtime, turn.sessionId, turnId)
  await r.settled()
  return r.wokenBy(turn.operationId)
}

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bot-room-hops-'))
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the room's reply and delivery paths read only journalReads.
  setStructuredAgentSessionHost(host as unknown as StructuredAgentSessionHost)
})
afterEach(() => {
  resetForkInboxSourcesForTests()
  setStructuredAgentSessionHost(null)
  journals.clear()
  rmSync(dir, { recursive: true, force: true })
})

/** The room on the database file, opened afresh, as the app's next start opens it. */
function openRoom(settings: Record<string, unknown>): Room {
  return room(settings, new SyncDatabase(join(dir, 'orchestration.db')))
}

describe('bot room hop limit, through member chats', () => {
  it('holds the hand-off a member chat end brings past the limit', async () => {
    const r = openRoom({ forkBotRoomHopLimit: 2 })
    r.post('post-1', ['bot-a'])
    const lines = await pingPong(r, 'post-1', 10, memberEnds)
    expect(lines).toHaveLength(2)
    // The third reply was read from its chat's journal, kept on its turn and woke nobody.
    expect(r.turnOn(lines[1]!)).toMatchObject({ reply: 'Round 2. @Bo your turn.', handedOff: [] })
    const items = await r.hopItems()
    expect(items.map((item) => item.chatId)).toEqual(['hops:post-1'])
    r.db.close()
  })

  it('keeps the count and the entry over a restart, and Continue works once after it', async () => {
    const first = openRoom({ forkBotRoomHopLimit: 3 })
    first.post('post-1', ['bot-a'])
    const before = await pingPong(first, 'post-1', 2, memberEnds)
    expect(before).toHaveLength(2)
    first.db.close()

    // Part way: one hop is left after the restart.
    const second = openRoom({ forkBotRoomHopLimit: 3 })
    const after = await pingPong(second, before[1]!, 10, memberEnds)
    expect(after).toHaveLength(1)
    expect(await second.hopItems()).toHaveLength(1)
    second.db.close()

    const third = openRoom({ forkBotRoomHopLimit: 3 })
    expect((await third.hopItems()).map((item) => item.chatId)).toEqual(['hops:post-1'])
    const heldOn = third.turnOn(after[0]!).operationId
    expect(await answerFromInboxSource('hops', 'hops:post-1', 'continue')).toBe('sent')
    await third.settled()
    expect(third.wokenBy(heldOn).map((line) => line.turns[0]!.botId)).toEqual(['bot-a'])
    expect(await answerFromInboxSource('hops', 'hops:post-1', 'continue')).toBe('not-waiting')
    expect(await third.hopItems()).toEqual([])

    // Removing the room takes its holds with it.
    third.groups.store.deleteGroup(third.group.id)
    third.groups.changed()
    expect(readBotRoomHopHold(third.db, heldOn)).toBeNull()
    third.db.close()
  })

  it('puts a Continue a quit cut short back on the inbox, and never wakes a stored one twice', async () => {
    const first = openRoom({ forkBotRoomHopLimit: 1 })
    first.post('post-1', ['bot-a'])
    const [line] = await pingPong(first, 'post-1', 10, memberEnds)
    const held = first.turnOn(line!)
    // Continue claimed the hold and cleared the turn's marker, then the app quit before the wake.
    expect(settleBotRoomHopHold(first.db, held.operationId, 'continuing')).toBe(true)
    const stored = first.groups.store.message(line!)!
    first.groups.store.update({
      ...stored,
      turns: stored.turns.map(({ handedOff: _handedOff, ...turn }) => turn)
    })
    first.db.close()

    const second = openRoom({ forkBotRoomHopLimit: 1 })
    expect((await second.hopItems()).map((item) => item.chatId)).toEqual(['hops:post-1'])
    expect(second.turnOn(line!).handedOff).toEqual([])
    // Claimed again, and this time the wake is stored before the quit.
    expect(settleBotRoomHopHold(second.db, held.operationId, 'continuing')).toBe(true)
    const again = second.groups.store.message(line!)!
    second.groups.store.update({
      ...again,
      turns: again.turns.map(({ handedOff: _handedOff, ...turn }) => turn)
    })
    await handOffGroupMentions(second.groups, second.groups.store.message(line!)!, held, {
      full: 'Round 1. @Ada your turn.',
      saved: 'Round 1. @Ada your turn.'
    })
    await second.settled()
    expect(second.wokenBy(held.operationId)).toHaveLength(1)
    second.db.close()

    const third = openRoom({ forkBotRoomHopLimit: 1 })
    expect(await third.hopItems()).toEqual([])
    expect(readBotRoomHopHold(third.db, held.operationId)?.state).toBe('continued')
    expect(await answerFromInboxSource('hops', 'hops:post-1', 'continue')).toBe('not-waiting')
    expect(third.wokenBy(held.operationId)).toHaveLength(1)
    third.db.close()
  })
})
