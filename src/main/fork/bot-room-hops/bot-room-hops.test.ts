// Bot room hop limit (BAD-801): bots naming each other in a group room (bot-room-hops-test-room.ts).
// No native session host here, so each woken turn's send fails and the test writes each reply.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetForkInboxSourcesForTests } from '../idle-recovery/idle-recovery-sources'
import {
  answerFromInboxSource,
  onForkInboxSourceChanged,
  pauseFromInboxSource
} from '../idle-recovery/idle-recovery-sources'
import {
  answerIdleRecoveryChat,
  listIdleRecoveryInbox
} from '../idle-recovery/idle-recovery-service'
import { FORK_INBOX_HANDLERS } from '../../../cli/fork/inbox-handlers'
import type { HandlerContext } from '../../../cli/dispatch/dispatch'
import { pingPong, room } from './bot-room-hops-test-room'

afterEach(() => {
  resetForkInboxSourcesForTests()
})

describe('bot room hop limit', () => {
  it('stops two bots naming each other at the limit with one entry, and Continue counts afresh once', async () => {
    const r = room({ forkBotRoomHopLimit: 3 })
    r.post('post-1', ['bot-a'])
    const lines = await pingPong(r, 'post-1', 10)
    // Three hand-offs woke a member; the fourth was held, its reply kept on its turn.
    expect(lines).toHaveLength(3)
    const held = r.turnOn(lines[2]!)
    expect(r.groups.store.message(lines[2]!)!.turns[0]).toMatchObject({
      reply: 'Round 3. @Ada your turn.',
      handedOff: []
    })
    const items = await r.hopItems()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ verdict: 'waiting_user', chatId: 'hops:post-1' })
    expect(items[0]!.question).toContain(
      'Last exchange:\nAda: Round 2. @Bo your turn.\nBo: Round 3. @Ada your turn.'
    )

    // Every window's inbox reads again on the change event (the bridge tells each one).
    const changed = vi.fn()
    const stop = onForkInboxSourceChanged(changed)
    expect(await answerFromInboxSource('hops', 'hops:post-1', 'continue')).toBe('sent')
    stop()
    expect(changed).toHaveBeenCalled()
    await r.settled()
    expect(await r.hopItems()).toEqual([])
    expect(await answerFromInboxSource('hops', 'hops:post-1', 'continue')).toBe('not-waiting')
    // The held hand-off woke Ada, as hop 1 of a fresh count: two more wake, the next is held.
    const resumed = r.wokenBy(held.operationId)
    expect(resumed.map((line) => line.turns[0]!.botId)).toEqual(['bot-a'])
    expect(await pingPong(r, resumed[0]!.id, 10)).toHaveLength(2)
    expect(await r.hopItems()).toHaveLength(1)
  })

  it('counts a reply naming several members by depth, and racing holds share one entry', async () => {
    const r = room({ forkBotRoomHopLimit: 3 })
    r.post('post-1', ['bot-a'])
    // Depth 1: Ada wakes Bo and Cy at once.
    const [toBo, toCy] = await r.reply('post-1', 'bot-a', '@Bo and @Cy, split the work.')
    // Depth 2 and 3 on both branches: five hand-offs so far, none held.
    const [boToAda] = await r.reply(toBo!.id, 'bot-b', '@Ada done with mine.')
    const [cyToAda] = await r.reply(toCy!.id, 'bot-c', '@Ada done too.')
    const [adaToBo] = await r.reply(boToAda!.id, 'bot-a', '@Bo check it.')
    const [adaToCy] = await r.reply(cyToAda!.id, 'bot-a', '@Cy check it.')
    expect([adaToBo, adaToCy].every(Boolean)).toBe(true)
    // Depth 4 on both: both held, one entry.
    expect(await r.reply(adaToBo!.id, 'bot-b', '@Ada looks fine.')).toEqual([])
    expect(await r.reply(adaToCy!.id, 'bot-c', '@Ada and @Bo, one more thing.')).toEqual([])
    const items = await r.hopItems()
    expect(items).toHaveLength(1)
    expect(items[0]!.question).toContain('2 replies were held')

    expect(await answerFromInboxSource('hops', 'hops:post-1', 'yes')).toBe('sent')
    await r.settled()
    expect(
      r.wokenBy(r.turnOn(adaToBo!.id).operationId).map((line) => line.turns[0]!.botId)
    ).toEqual(['bot-a'])
    expect(
      r.wokenBy(r.turnOn(adaToCy!.id).operationId).map((line) => line.turns[0]!.botId)
    ).toEqual(['bot-a', 'bot-b'])
  })

  it('names each held chain of one post once, and the CLI says dismissed', async () => {
    const r = room({ forkBotRoomHopLimit: 2 })
    // One post names Ada and Bo: two chains, each ends held at the limit.
    const post = r.post('post-1', ['bot-a', 'bot-b'])
    // Bo's turn has ended without naming anyone yet, so Ada's hand-offs need not read Bo's chat.
    r.groups.store.update({
      ...post,
      turns: post.turns.map((turn) => (turn.botId === 'bot-b' ? { ...turn, reply: 'Done.' } : turn))
    })
    expect(await pingPong(r, 'post-1', 10)).toHaveLength(2)
    const [toAda] = await r.reply('post-1', 'bot-b', '@Ada over to you.')
    expect(await pingPong(r, toAda!.id, 10)).toHaveLength(1)
    const items = await r.hopItems()
    expect(items).toHaveLength(1)
    const { question } = items[0]!
    expect(question).toContain('Ada and Bo kept naming each other after')
    expect(question).not.toMatch(/Bo named Bo|Ada named Ada|named Ada, Bo|named Bo, Ada/)
    expect(question).toContain('2 replies were held.')
    expect(question.match(/fresh count/g)).toHaveLength(1)
    expect(question.match(/Continue lets/g)).toHaveLength(1)

    // The real `orca inbox pause` handler over the real source: the entry is dismissed.
    const printed: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      printed.push(line)
    })
    const ctx = {
      flags: new Map([['id', 'hops:post-1']]),
      json: false,
      cwd: '/tmp',
      client: {
        call: async (method: string, params: { chatId: string; paused: boolean }) => {
          const result =
            method === 'fork.idleRecovery.inbox'
              ? { now: Date.now(), mode: 'inbox', items: await r.hopItems() }
              : await pauseFromInboxSource({ ...params, source: 'hops' }, 0)
          return { id: '1', ok: true, result, _meta: { runtimeId: 't' } }
        }
      }
    } as unknown as HandlerContext
    await FORK_INBOX_HANDLERS['inbox pause'](ctx)
    expect(printed).toEqual(['hops:post-1: dismissed'])
    expect(await r.hopItems()).toEqual([])
    vi.restoreAllMocks()
  })

  it('a person post makes a held entry moot and starts a new count', async () => {
    const r = room({ forkBotRoomHopLimit: 2 })
    r.post('post-1', ['bot-a'])
    expect(await pingPong(r, 'post-1', 10)).toHaveLength(2)
    expect(await r.hopItems()).toHaveLength(1)

    r.post('post-2', ['bot-b'])
    r.groups.changed(r.group.id)
    expect(await r.hopItems()).toEqual([])
    expect(await answerFromInboxSource('hops', 'hops:post-1', 'continue')).toBe('not-waiting')
    expect(await pingPong(r, 'post-2', 10)).toHaveLength(2)
    const items = await r.hopItems()
    expect(items.map((item) => item.chatId)).toEqual(['hops:post-2'])
    // Dismiss takes it off, wakes nobody and tells every window's inbox, as Continue does.
    const changed = vi.fn()
    const stop = onForkInboxSourceChanged(changed)
    expect(
      (await pauseFromInboxSource({ chatId: 'hops:post-2', paused: true, source: 'hops' }, 0)).saved
    ).toBe(true)
    stop()
    expect(changed).toHaveBeenCalled()
    expect(await r.hopItems()).toEqual([])
  })

  it('leaves a normal exchange alone, and 0 is no limit', async () => {
    const usual = room({})
    usual.post('post-1', ['bot-a'])
    // Under the default of 6, a two-bot exchange wakes each reply's member as before.
    expect(await pingPong(usual, 'post-1', 4)).toHaveLength(4)
    expect(await usual.hopItems()).toEqual([])

    const open = room({ forkBotRoomHopLimit: 0 })
    open.post('post-1', ['bot-a'])
    expect(await pingPong(open, 'post-1', 12)).toHaveLength(12)
    expect(await open.hopItems()).toEqual([])
  })

  it('lists and continues through the inbox RPC a paired server answers for its own rooms', async () => {
    // fork.idleRecovery.inbox and .answer call these; `orca inbox` on a server reaches them.
    const r = room({ forkBotRoomHopLimit: 1 })
    r.post('post-1', ['bot-a'])
    expect(await pingPong(r, 'post-1', 10)).toHaveLength(1)
    const listed = await listIdleRecoveryInbox()
    expect(
      listed.items.filter((item) => item.source === 'hops').map((item) => item.chatId)
    ).toEqual(['hops:post-1'])
    expect(
      await answerIdleRecoveryChat({ chatId: 'hops:post-1', text: 'go on', source: 'hops' })
    ).toEqual({ chatId: 'hops:post-1', result: 'sent' })
    await r.settled()
    expect(await r.hopItems()).toEqual([])
  })
})
