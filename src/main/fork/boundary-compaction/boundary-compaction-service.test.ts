import { describe, expect, it, vi } from 'vitest'
import type { BoundaryCompactionJournalFacts } from '../../../shared/fork/boundary-compaction'
import type { ForkCacheState } from '../../../shared/fork/usage-ledger'
import type {
  BoundaryCompactionChatRest,
  BoundaryCompactionHost,
  BoundaryCompactionSendOutcome
} from './boundary-compaction-host'
import {
  FORK_BOUNDARY_COMPACTION_IDLE_SWEEP_MS,
  FORK_BOUNDARY_COMPACTION_SWEEP_MS,
  createBoundaryCompactionService
} from './boundary-compaction-service'

const NOW = 1_700_000_000_000
const MINUTE = 60_000

type Chat = {
  rest: BoundaryCompactionChatRest | null
  journal: BoundaryCompactionJournalFacts | null
}

function chat(rest: Partial<BoundaryCompactionChatRest> = {}, journal = {}): Chat {
  return {
    rest: {
      fence: 3,
      compactable: true,
      awake: true,
      inTurn: false,
      backgroundRunning: false,
      idleSince: NOW - 30 * MINUTE,
      ...rest
    },
    journal: {
      requestItemId: 'request-1',
      commandSinceRequest: false,
      queued: false,
      contextTokens: 150_000,
      measuredAt: NOW - 31 * MINUTE,
      ...journal
    }
  }
}

function setup(
  chats: Record<string, Chat>,
  options: {
    settings?: Record<string, unknown>
    typed?: (sessionId: string) => boolean | null
    cacheStates?: ForkCacheState[]
    outcome?: BoundaryCompactionSendOutcome
    windowless?: boolean
  } = {}
) {
  const settings: Record<string, unknown> = { forkBoundaryCompactMode: 'on', ...options.settings }
  const clock = { now: NOW }
  const sent: { sessionId: string; fence: number; operationId: string }[] = []
  const host = {
    chatIds: vi.fn(() => Object.keys(chats)),
    rest: vi.fn((sessionId: string) => chats[sessionId]?.rest ?? null),
    journal: vi.fn(async (sessionId: string) => chats[sessionId]?.journal ?? null),
    compact: vi.fn(async (sessionId: string, fence: number, operationId: string) => {
      sent.push({ sessionId, fence, operationId })
      return options.outcome ?? 'started'
    })
  } satisfies BoundaryCompactionHost
  const forgetTyped = vi.fn()
  const timers: { run: () => Promise<boolean>; baseMs: number; maxMs: number; stopped: boolean }[] =
    []
  const service = createBoundaryCompactionService({
    now: () => clock.now,
    host,
    typed: options.typed ?? (() => false),
    forgetTyped,
    cacheStates: () => options.cacheStates ?? [],
    randomId: () => 'r4nd0m',
    startTimer: (timer) => {
      const entry = { run: timer.run, baseMs: timer.baseMs, maxMs: timer.maxMs, stopped: false }
      timers.push(entry)
      return () => {
        entry.stopped = true
      }
    }
  })
  let listener: ((updates: Record<string, unknown>) => void) | undefined
  const store = {
    onSettingsChanged: (next: (updates: Record<string, unknown>) => void) => {
      listener = next
    }
  }
  service.start(() => settings, {
    store: () => store,
    ...(options.windowless ? { windowless: () => true } : {})
  })
  return {
    service,
    host,
    sent,
    settings,
    clock,
    timers,
    forgetTyped,
    change: (updates: Record<string, unknown>) => {
      Object.assign(settings, updates)
      listener?.(updates)
    }
  }
}

describe('boundary compaction sweep', () => {
  it('reads no chat and sends nothing while the mode is off', async () => {
    const off = setup({ a: chat() }, { settings: { forkBoundaryCompactMode: 'off' } })
    expect(await off.service.sweep()).toBe(false)
    const unset = setup({ a: chat() }, { settings: { forkBoundaryCompactMode: undefined } })
    expect(await unset.service.sweep()).toBe(false)
    for (const { host, sent } of [off, unset]) {
      expect(host.chatIds).not.toHaveBeenCalled()
      expect(host.rest).not.toHaveBeenCalled()
      expect(host.journal).not.toHaveBeenCalled()
      expect(sent).toEqual([])
    }
  })

  it('starts one backing-off timer and restarts it when the mode changes', () => {
    const { service, timers, change } = setup({})
    expect(timers).toHaveLength(1)
    expect(timers[0]).toMatchObject({
      baseMs: FORK_BOUNDARY_COMPACTION_SWEEP_MS,
      maxMs: FORK_BOUNDARY_COMPACTION_IDLE_SWEEP_MS
    })
    service.start(() => ({}))
    expect(timers).toHaveLength(1)
    change({ forkBoundaryCompactThresholdTokens: 90_000 })
    expect(timers).toHaveLength(1)
    change({ forkBoundaryCompactMode: 'off' })
    expect(timers).toHaveLength(2)
    expect(timers[0]?.stopped).toBe(true)
    service.stop()
    expect(timers[1]?.stopped).toBe(true)
  })

  it('asks an idle chat past the threshold to compact, with its fence and a marked id', async () => {
    const { service, sent } = setup({ a: chat() })
    expect(await service.sweep()).toBe(true)
    expect(sent).toEqual([
      { sessionId: 'a', fence: 3, operationId: `fork-boundary-compact-${NOW}-r4nd0m` }
    ])
    expect(service.lastOutcomes().get('a')).toBe('started')
  })

  it('compacts once per turn ending, however the attempt went', async () => {
    const chats = { a: chat() }
    const { service, sent, host, clock } = setup(chats, { outcome: 'unknown' })
    await service.sweep()
    clock.now += MINUTE
    await service.sweep()
    await service.sweep()
    expect(sent).toHaveLength(1)
    expect(service.lastOutcomes().get('a')).toBeUndefined()
    // The settled refusal is remembered, so the journal is not read again for this ending.
    expect(host.journal).toHaveBeenCalledTimes(2)

    // The chat takes another turn: a new ending, and it may be compacted again.
    chats.a = chat({ idleSince: clock.now - 10 * MINUTE }, { measuredAt: clock.now - 10 * MINUTE })
    await service.sweep()
    expect(sent).toHaveLength(2)
  })

  it('does not compact a chat it already compacted since its last turn', async () => {
    const { service, sent } = setup({
      a: chat({}, { commandSinceRequest: true, contextTokens: null, measuredAt: null })
    })
    await service.sweep()
    expect(sent).toEqual([])
    expect(service.lastOutcomes().get('a')).toBe('already-compacted')
  })

  it.each([
    ['not-compactable', chat({ compactable: false })],
    ['asleep', chat({ awake: false })],
    ['asleep', { rest: null, journal: null }],
    ['working', chat({ inTurn: true, idleSince: null })],
    ['background-work', chat({ backgroundRunning: true })],
    ['not-idle-long-enough', chat({ idleSince: NOW - MINUTE })],
    ['queued-message', chat({}, { queued: true })],
    ['no-request', chat({}, { requestItemId: null })],
    ['context-unknown', chat({}, { contextTokens: null })],
    ['below-threshold', chat({}, { contextTokens: 100_000 })]
  ] as const)('leaves a chat alone: %s', async (reason, subject) => {
    const { service, sent } = setup({ a: subject })
    await service.sweep()
    expect(sent).toEqual([])
    expect(service.lastOutcomes().get('a')).toBe(reason)
  })

  it('leaves a paused chat alone, with idle recovery itself off', async () => {
    const { service, sent } = setup(
      { a: chat(), b: chat() },
      { settings: { forkIdleSweepMode: 'off', forkIdleSweepPaused: ['a'] } }
    )
    await service.sweep()
    expect(sent.map((entry) => entry.sessionId)).toEqual(['b'])
    expect(service.lastOutcomes().get('a')).toBe('paused')
  })

  it('leaves a chat with typed text alone, and every chat while no window has reported', async () => {
    const typed = setup({ a: chat(), b: chat() }, { typed: (id) => id === 'a' })
    await typed.service.sweep()
    expect(typed.sent.map((entry) => entry.sessionId)).toEqual(['b'])
    expect(typed.service.lastOutcomes().get('a')).toBe('typed-text')

    const unknown = setup({ a: chat() }, { typed: () => null })
    await unknown.service.sweep()
    expect(unknown.sent).toEqual([])
    expect(unknown.host.journal).not.toHaveBeenCalled()
    expect(unknown.service.lastOutcomes().get('a')).toBe('typed-unknown')
  })

  it('does not wait for a report on a host that has no window', async () => {
    const server = setup({ a: chat(), b: chat() }, { typed: () => null, windowless: true })
    await server.service.sweep()
    expect(server.sent.map((entry) => entry.sessionId)).toEqual(['a', 'b'])

    // A report that does arrive is still honored there.
    const reported = setup(
      { a: chat(), b: chat() },
      { typed: (id) => id === 'a', windowless: true }
    )
    await reported.service.sweep()
    expect(reported.sent.map((entry) => entry.sessionId)).toEqual(['b'])
    expect(reported.service.lastOutcomes().get('a')).toBe('typed-text')
  })

  it('waits for a warm cache, up to the longest wait', async () => {
    const hour: ForkCacheState = {
      sessionId: 'a',
      lastAt: NOW - 10 * MINUTE,
      contextTokens: 150_000,
      ttl: '1h',
      working: false
    }
    const chats = {
      a: chat({ idleSince: NOW - 10 * MINUTE }),
      b: chat({ idleSince: NOW - 10 * MINUTE })
    }
    const { service, sent, clock } = setup(chats, { cacheStates: [hour] })
    await service.sweep()
    // b has no reported lifetime, so the 5 minute setting applies and its cache is cold.
    expect(sent.map((entry) => entry.sessionId)).toEqual(['b'])
    expect(service.lastOutcomes().get('a')).toBe('not-idle-long-enough')
    clock.now += 11 * MINUTE
    await service.sweep()
    expect(sent.map((entry) => entry.sessionId)).toEqual(['b', 'a'])
  })

  it('does not wait for the cache with prefer cold off', async () => {
    const { service, sent } = setup(
      { a: chat({ idleSince: NOW - 3 * MINUTE }) },
      { settings: { forkBoundaryCompactPreferCold: false } }
    )
    await service.sweep()
    expect(sent).toHaveLength(1)
  })

  it('looks again after the journal read and backs out when the chat got busy', async () => {
    const chats = { a: chat() }
    const { service, sent, host } = setup(chats)
    host.journal.mockImplementationOnce(async () => {
      const facts = chats.a.journal
      chats.a = chat({ inTurn: true, idleSince: null })
      return facts
    })
    await service.sweep()
    expect(sent).toEqual([])
    expect(service.lastOutcomes().get('a')).toBe('working')
  })

  it('forgets what it knew when the mode goes off', async () => {
    const { service, sent, change, forgetTyped } = setup({ a: chat() })
    await service.sweep()
    change({ forkBoundaryCompactMode: 'off' })
    expect(await service.sweep()).toBe(false)
    expect(forgetTyped).toHaveBeenCalled()
    expect(service.lastOutcomes().size).toBe(0)
    expect(sent).toHaveLength(1)
  })
})
