import { describe, expect, it } from 'vitest'
import { claudeUsageObservation } from './claude-usage-frames'
import { UsageLedger } from './usage-ledger'
import { parseLedgerData } from './usage-ledger-model'
import {
  assistantFrame,
  COMPACT_FRAME,
  fakeClock,
  initFrame,
  RESULT_FRAME,
  utcDay
} from './usage-ledger-fixtures'

function setup(isLongContext?: (model: string | null) => boolean) {
  const clock = fakeClock()
  const ledger = new UsageLedger({
    now: clock.now,
    dayKey: utcDay,
    ...(isLongContext ? { isLongContext } : {})
  })
  const feed = (sessionId: string, frame: Record<string, unknown>): boolean => {
    const observation = claudeUsageObservation(frame)
    return observation ? ledger.observe(sessionId, observation) : false
  }
  return { clock, ledger, feed }
}

describe('claudeUsageObservation', () => {
  it('reads per-call usage, the model and a 1 h cache lifetime', () => {
    const observation = claudeUsageObservation(
      assistantFrame({ id: 'msg_1', input: 10, output: 5, cacheWrite: 300, cacheWrite1h: 300 })
    )
    expect(observation).toEqual({
      kind: 'call',
      callId: 'msg_1',
      model: 'claude-sonnet-4-5',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 300,
        cacheWrite1hTokens: 300
      },
      root: true,
      ttl: '1h'
    })
  })

  it('marks sub-agent calls as not root and skips zero-usage synthetic replies', () => {
    const child = claudeUsageObservation(
      assistantFrame({ id: 'msg_2', input: 1, parentToolUseId: 'toolu_1' })
    )
    expect(child).toMatchObject({ kind: 'call', root: false })
    expect(claudeUsageObservation(assistantFrame({ id: 'msg_3' }))).toBeNull()
  })

  it('reads turn ends, compactions and billing from init', () => {
    expect(claudeUsageObservation(RESULT_FRAME)).toEqual({ kind: 'turn-end' })
    expect(claudeUsageObservation(COMPACT_FRAME)).toEqual({ kind: 'context-reset' })
    expect(claudeUsageObservation(initFrame('none'))).toEqual({
      kind: 'init',
      billing: 'subscription'
    })
    expect(claudeUsageObservation(initFrame('ANTHROPIC_API_KEY'))).toEqual({
      kind: 'init',
      billing: 'api'
    })
    expect(claudeUsageObservation({ ...RESULT_FRAME, parent_tool_use_id: 'toolu_1' })).toBeNull()
  })
})

describe('UsageLedger', () => {
  it('counts a call once across the frames that repeat its usage', () => {
    const { ledger, feed, clock } = setup()
    feed('chat-a', assistantFrame({ id: 'msg_1', input: 100, cacheRead: 1000, output: 2 }))
    feed('chat-a', assistantFrame({ id: 'msg_1', input: 100, cacheRead: 1000, output: 40 }))
    feed('chat-a', RESULT_FRAME)
    const day = ledger.snapshot().chats['chat-a'].days[utcDay(clock.now())]
    expect(day['claude-sonnet-4-5']).toEqual({
      tokens: {
        inputTokens: 100,
        outputTokens: 40,
        cacheReadTokens: 1000,
        cacheWriteTokens: 0,
        cacheWrite1hTokens: 0
      },
      calls: 1
    })
    expect(ledger.snapshot().chats['chat-a'].turns).toBe(1)
  })

  it('includes sub-agent calls in the totals but sizes the context from the main thread', () => {
    const { ledger, feed } = setup()
    feed('chat-a', assistantFrame({ id: 'msg_1', input: 5, cacheRead: 60_000, cacheWrite: 2000 }))
    feed('chat-a', assistantFrame({ id: 'msg_2', input: 9000, parentToolUseId: 'toolu_1' }))
    const chat = ledger.snapshot().chats['chat-a']
    expect(chat.contextTokens).toBe(62_005)
    expect(chat.days[Object.keys(chat.days)[0]]['claude-sonnet-4-5'].tokens.inputTokens).toBe(9005)
  })

  it('reports the cache state, working until the turn ends, and remembers a seen TTL', () => {
    const { ledger, feed, clock } = setup()
    feed(
      'chat-a',
      assistantFrame({ id: 'msg_1', input: 5, cacheWrite: 70_000, cacheWrite1h: 70_000 })
    )
    expect(ledger.cacheStates()).toEqual([
      { sessionId: 'chat-a', lastAt: clock.now(), contextTokens: 70_005, ttl: '1h', working: true }
    ])
    clock.advance(30_000)
    feed('chat-a', RESULT_FRAME)
    expect(ledger.cacheStates()[0]).toMatchObject({ lastAt: clock.now(), working: false })
    ledger.noteTurnStart('chat-a')
    expect(ledger.cacheStates()[0].working).toBe(true)
    expect(ledger.noteEnded('chat-a')).toBe(true)
    expect(ledger.cacheStates()[0].working).toBe(false)
  })

  it('forgets the context size after a compaction until the next call', () => {
    const { ledger, feed } = setup()
    feed('chat-a', assistantFrame({ id: 'msg_1', input: 80_000 }))
    feed('chat-a', COMPACT_FRAME)
    expect(ledger.cacheStates()).toEqual([])
    feed('chat-a', assistantFrame({ id: 'msg_2', input: 4000 }))
    expect(ledger.cacheStates()[0].contextTokens).toBe(4000)
  })

  it('splits days by the injected clock and keeps billing and names', () => {
    const { ledger, feed, clock } = setup()
    feed('chat-a', initFrame('none'))
    feed('chat-a', assistantFrame({ id: 'msg_1', input: 10 }))
    clock.advance(86_400_000)
    feed('chat-a', assistantFrame({ id: 'msg_2', input: 20, model: 'claude-opus-4-1' }))
    ledger.noteMeta('chat-a', { title: 'Fix the parser', workspaceName: 'feature-x' })
    const chat = ledger.snapshot().chats['chat-a']
    expect(Object.keys(chat.days)).toHaveLength(2)
    expect(chat).toMatchObject({
      billing: 'subscription',
      title: 'Fix the parser',
      workspaceName: 'feature-x'
    })
  })

  it('marks calls over the long-context threshold', () => {
    const { ledger, feed } = setup((model) => model === 'claude-sonnet-4-5')
    feed('chat-a', assistantFrame({ id: 'msg_1', input: 250_000, output: 10 }))
    const cell = Object.values(ledger.snapshot().chats['chat-a'].days)[0]['claude-sonnet-4-5']
    expect(cell.tokens.longContext).toMatchObject({ inputTokens: 250_000, outputTokens: 10 })
  })

  it('prunes old days, empty chats and the oldest chats past the cap', () => {
    const { ledger, feed, clock } = setup()
    feed('old', assistantFrame({ id: 'msg_1', input: 10 }))
    clock.advance(40 * 86_400_000)
    feed('mid', assistantFrame({ id: 'msg_2', input: 10 }))
    clock.advance(1000)
    feed('new', assistantFrame({ id: 'msg_3', input: 10 }))
    expect(ledger.prune(30)).toBe(true)
    expect(Object.keys(ledger.snapshot().chats).sort()).toEqual(['mid', 'new'])
    ledger.prune(30, 1)
    expect(Object.keys(ledger.snapshot().chats)).toEqual(['new'])
  })

  it('survives a save and load, still deduping a call it saw before', () => {
    const { ledger, feed, clock } = setup()
    feed('chat-a', assistantFrame({ id: 'msg_1', input: 100, output: 5 }))
    const reloaded = new UsageLedger(
      { now: clock.now, dayKey: utcDay },
      parseLedgerData(JSON.stringify(ledger.snapshot()))
    )
    const observation = claudeUsageObservation(
      assistantFrame({ id: 'msg_1', input: 100, output: 9 })
    )
    reloaded.observe('chat-a', observation!)
    const cell = Object.values(reloaded.snapshot().chats['chat-a'].days)[0]['claude-sonnet-4-5']
    expect(cell).toMatchObject({ calls: 1, tokens: { inputTokens: 100, outputTokens: 9 } })
  })

  it('reads a damaged file as empty or partial, never throwing past JSON', () => {
    expect(parseLedgerData('{"version":2}').chats).toEqual({})
    const partial = parseLedgerData(
      '{"version":1,"chats":{"a":{"lastAt":5,"days":{"bad":{},"2026-01-01":{"m":{"calls":1}}}},"b":7}}'
    )
    expect(Object.keys(partial.chats)).toEqual(['a'])
    expect(Object.keys(partial.chats.a.days)).toEqual(['2026-01-01'])
    expect(partial.chats.a.days['2026-01-01'].m.tokens.inputTokens).toBe(0)
  })

  it('clears everything', () => {
    const { ledger, feed } = setup()
    feed('chat-a', assistantFrame({ id: 'msg_1', input: 100 }))
    ledger.clear()
    expect(ledger.snapshot().chats).toEqual({})
    expect(ledger.cacheStates()).toEqual([])
  })
})
