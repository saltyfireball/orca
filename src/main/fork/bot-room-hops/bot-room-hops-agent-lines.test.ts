// Bot room hops (BAD-844): only a person's post starts a new count. A room line agents made (an
// item change, a late worker report) carries on its chain, and a turn cap bounds fan-out.
import { describe, expect, it } from 'vitest'
import { answerFromInboxSource } from '../idle-recovery/idle-recovery-sources'
import { botRoomHandOffDepth } from './bot-room-hop-store'
import { pingPong, room, type Room } from './bot-room-hops-test-room'

/** Ada and Bo name each other under post-1 until the limit of 3 holds the fourth hand-off. */
async function heldAtLimit(): Promise<Room> {
  const r = room({ forkBotRoomHopLimit: 3 })
  r.post('post-1', ['bot-a'])
  expect(await pingPong(r, 'post-1', 10)).toHaveLength(3)
  expect((await r.hopItems()).map((item) => item.chatId)).toEqual(['hops:post-1'])
  return r
}

describe('bot room hops: lines agents made', () => {
  for (const kind of ['fromItems', 'fromReports'] as const) {
    it(`a ${kind} line keeps the held entry and does not restart the count`, async () => {
      const r = await heldAtLimit()
      r.agentLine('agent-line', 'bot-b', kind)
      r.groups.changed(r.group.id)
      expect((await r.hopItems()).map((item) => item.chatId)).toEqual(['hops:post-1'])
      // Its reply naming Ada is past the limit too, and joins the same entry.
      expect(await r.reply('agent-line', 'bot-b', '@Ada one more pass.')).toEqual([])
      const items = await r.hopItems()
      expect(items.map((item) => item.chatId)).toEqual(['hops:post-1'])
      expect(items[0]!.question).toContain('2 replies were held.')
    })
  }

  it("a person's post still makes the entry moot and starts a new count", async () => {
    const r = await heldAtLimit()
    r.agentLine('agent-line', 'bot-b', 'fromItems')
    expect(await r.reply('agent-line', 'bot-b', 'Noted.')).toEqual([])
    r.post('post-2', ['bot-c'])
    r.groups.changed(r.group.id)
    expect(await r.hopItems()).toEqual([])
    const [woken] = await r.reply('post-2', 'bot-c', '@Ada take this.')
    expect(botRoomHandOffDepth(r.groups.store, woken!)).toBe(1)
  })
})

describe('bot room turn cap', () => {
  it('stops four bots naming each other at the cap below the hop limit, and Continue counts afresh', async () => {
    const r = room({ forkBotRoomTurnCap: 7 })
    r.post('post-1', ['bot-a'])
    const others = (botId: string) =>
      ['@Ada', '@Bo', '@Cy', '@Di'].filter((_, at) => `bot-${'abcd'[at]}` !== botId).join(' ')
    const fanOut = async (lineId: string) => {
      const botId = r.turnOn(lineId).botId
      return r.reply(lineId, botId, `${others(botId)} over to you.`)
    }
    // Ada wakes three (3 turns), Bo three more (6); Cy and Di would pass 7 and are held.
    const [toBo, toCy, toDi] = await fanOut('post-1')
    const fromBo = await fanOut(toBo!.id)
    expect(fromBo).toHaveLength(3)
    expect(await fanOut(toCy!.id)).toEqual([])
    expect(await fanOut(toDi!.id)).toEqual([])
    for (const line of fromBo) {
      expect(await fanOut(line.id)).toEqual([])
    }
    const deepest = Math.max(
      ...[toBo!, ...fromBo].map((line) => botRoomHandOffDepth(r.groups.store, line))
    )
    expect(deepest).toBe(2)
    const items = await r.hopItems()
    expect(items).toHaveLength(1)
    expect(items[0]!.title).toContain('6 woken turns')
    expect(items[0]!.question).toContain('after 6 woken turns under one post')

    expect(await answerFromInboxSource('hops', 'hops:post-1', 'continue')).toBe('sent')
    await r.settled()
    expect(await r.hopItems()).toEqual([])
    // The five held hand-offs woke 15 members on a fresh count; one more hand-off is past it.
    const resumed = [toCy!, toDi!, ...fromBo].flatMap((line) =>
      r.wokenBy(r.turnOn(line.id).operationId)
    )
    expect(resumed).toHaveLength(15)
    expect(await fanOut(resumed[0]!.id)).toEqual([])
    expect(await r.hopItems()).toHaveLength(1)
  })

  it('counts a fresh cap after Continue', async () => {
    const r = room({ forkBotRoomTurnCap: 4 })
    r.post('post-1', ['bot-a'])
    const [toBo, toCy, toDi] = await r.reply('post-1', 'bot-a', '@Bo @Cy @Di go.')
    expect(await r.reply(toBo!.id, 'bot-b', '@Ada done.')).toHaveLength(1)
    // Five would pass the cap of 4: held, while the old count would hold any further hand-off.
    expect(await r.reply(toCy!.id, 'bot-c', '@Ada done.')).toEqual([])
    expect(await r.reply(toDi!.id, 'bot-d', 'Nothing for anyone.')).toEqual([])
    expect(await answerFromInboxSource('hops', 'hops:post-1', 'continue')).toBe('sent')
    await r.settled()
    const [resumed] = r.wokenBy(r.turnOn(toCy!.id).operationId)
    // Fresh count: 1 woken by Continue, then 3 more fit under 4; the next is held.
    const chain = await pingPong(r, resumed!.id, 10)
    expect(chain).toHaveLength(3)
    expect(await r.hopItems()).toHaveLength(1)
  })
})
