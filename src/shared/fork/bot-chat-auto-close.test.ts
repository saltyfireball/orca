// BAD-734: which bot chats close by themselves, and which never do.
import { describe, expect, it } from 'vitest'
import type { BotChatTreeChat, BotChatTreeWorker } from '../bots/bot-chat-tree'
import {
  forkBotChatAutoCloseEnabled,
  forkBotChatAutoCloseGraceMs,
  forkBotChatAutoCloseIdleMs,
  forkBotChatCardKey,
  forkBotChatCloseVerdict,
  forkBotChatClosedNote,
  forkBotChatOutcome,
  forkOwnerTypedAt,
  type ForkBotChatCloseFacts
} from './bot-chat-auto-close'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = 100 * HOUR
const TIMES = { now: NOW, idleMs: 24 * HOUR, graceMs: 10 * MIN }

function chat(fields: Partial<BotChatTreeChat> = {}): ForkBotChatCloseFacts['chat'] {
  return {
    chatId: 'c1',
    title: 'BAD-12: Merge PR 95',
    origin: 'side',
    live: 'idle',
    lastActiveAt: NOW - 30 * MIN,
    closed: false,
    running: [],
    runningTotal: 0,
    ...fields
  }
}

function facts(fields: Partial<ForkBotChatCloseFacts> = {}): ForkBotChatCloseFacts {
  return {
    chat: chat(),
    autoStarted: true,
    queued: false,
    openItem: false,
    ownerTypedAt: null,
    lastInboundAt: null,
    reportedBackAt: null,
    cardState: 'open',
    ...fields
  }
}

const worker = (state: BotChatTreeWorker['state']): BotChatTreeWorker => ({
  key: 'w',
  title: 'w',
  state,
  startedAt: 0
})

describe('close conditions', () => {
  it('closes a chat whose card is Done', () => {
    expect(forkBotChatCloseVerdict(facts({ cardState: 'done' }), TIMES)).toEqual({
      close: true,
      reason: 'card-finished'
    })
  })

  it('closes a chat whose card is Canceled', () => {
    expect(forkBotChatCloseVerdict(facts({ cardState: 'canceled' }), TIMES)).toEqual({
      close: true,
      reason: 'card-finished'
    })
  })

  it('closes an auto-started chat that reported back, once the grace has passed', () => {
    const answered = facts({ lastInboundAt: NOW - 3 * HOUR, reportedBackAt: NOW - 2 * HOUR })
    expect(forkBotChatCloseVerdict(answered, TIMES)).toEqual({ close: true, reason: 'job-ended' })
  })

  it('closes a chat idle past the idle window', () => {
    const old = facts({ autoStarted: false, chat: chat({ lastActiveAt: NOW - 25 * HOUR }) })
    expect(forkBotChatCloseVerdict(old, TIMES)).toEqual({ close: true, reason: 'idle' })
  })
})

describe('the grace period and a follow-up', () => {
  it('keeps a just-finished chat open for the grace, then closes it', () => {
    const fresh = facts({
      reportedBackAt: NOW - 3 * MIN,
      chat: chat({ lastActiveAt: NOW - 3 * MIN })
    })
    expect(forkBotChatCloseVerdict(fresh, TIMES)).toEqual({ close: false, keep: 'grace' })
    const later = { ...fresh, chat: chat({ lastActiveAt: NOW - 11 * MIN }) }
    expect(forkBotChatCloseVerdict(later, TIMES)).toEqual({ close: true, reason: 'job-ended' })
  })

  it('restarts the wait when a follow-up arrives within the grace', () => {
    const followUp = facts({
      reportedBackAt: NOW - 20 * MIN,
      chat: chat({ lastActiveAt: NOW - 2 * MIN })
    })
    expect(forkBotChatCloseVerdict(followUp, TIMES)).toEqual({ close: false, keep: 'grace' })
  })

  it('does not treat the job as ended while mail came after the answer', () => {
    const reopenedJob = facts({
      lastInboundAt: NOW - 15 * MIN,
      reportedBackAt: NOW - 40 * MIN
    })
    expect(forkBotChatCloseVerdict(reopenedJob, TIMES)).toEqual({ close: false, keep: 'in-use' })
  })

  it('gives a card that went Done the grace too', () => {
    const fresh = facts({ cardState: 'done', chat: chat({ lastActiveAt: NOW - 2 * MIN }) })
    expect(forkBotChatCloseVerdict(fresh, TIMES)).toEqual({ close: false, keep: 'grace' })
  })

  it('does not close an owner-started chat on a report-back alone', () => {
    const own = facts({ autoStarted: false, reportedBackAt: NOW - 2 * HOUR })
    expect(forkBotChatCloseVerdict(own, TIMES)).toEqual({ close: false, keep: 'in-use' })
  })
})

describe('never closes', () => {
  const done = { cardState: 'done' as const }

  it('the Home Chat', () => {
    const home = facts({ ...done, chat: chat({ origin: 'home', lastActiveAt: 0 }) })
    expect(forkBotChatCloseVerdict(home, TIMES)).toEqual({ close: false, keep: 'home' })
  })

  it('a chat that is already closed', () => {
    expect(
      forkBotChatCloseVerdict(facts({ ...done, chat: chat({ closed: true }) }), TIMES)
    ).toEqual({
      close: false,
      keep: 'already-closed'
    })
  })

  it('a chat with a running turn', () => {
    expect(
      forkBotChatCloseVerdict(facts({ ...done, chat: chat({ live: 'replying' }) }), TIMES)
    ).toEqual({ close: false, keep: 'working' })
  })

  it('a chat with a worker still running', () => {
    const busy = chat({ runningTotal: 1, running: [worker('running')] })
    expect(forkBotChatCloseVerdict(facts({ ...done, chat: busy }), TIMES)).toEqual({
      close: false,
      keep: 'working'
    })
  })

  it('a chat with mail queued', () => {
    expect(forkBotChatCloseVerdict(facts({ ...done, queued: true }), TIMES)).toEqual({
      close: false,
      keep: 'queued'
    })
  })

  it('a chat with an unanswered question', () => {
    expect(
      forkBotChatCloseVerdict(facts({ ...done, chat: chat({ live: 'needs-you' }) }), TIMES)
    ).toEqual({ close: false, keep: 'needs-you' })
  })

  it('a chat whose worker waits on the owner', () => {
    const waiting = chat({ runningTotal: 1, running: [worker('needs-you')] })
    expect(forkBotChatCloseVerdict(facts({ ...done, chat: waiting }), TIMES)).toEqual({
      close: false,
      keep: 'needs-you'
    })
  })

  it('a chat with an open needs-you item', () => {
    expect(forkBotChatCloseVerdict(facts({ ...done, openItem: true }), TIMES)).toEqual({
      close: false,
      keep: 'needs-you'
    })
  })

  it('a chat the owner typed into within the idle window', () => {
    const typed = facts({ ...done, ownerTypedAt: NOW - 3 * HOUR })
    expect(forkBotChatCloseVerdict(typed, TIMES)).toEqual({ close: false, keep: 'owner-typed' })
  })

  it('closes once the owner last typed longer ago than the idle window', () => {
    const stale = facts({
      ...done,
      ownerTypedAt: NOW - 30 * HOUR,
      chat: chat({ lastActiveAt: NOW - 30 * HOUR })
    })
    expect(forkBotChatCloseVerdict(stale, TIMES)).toEqual({ close: true, reason: 'card-finished' })
  })
})

describe('what counts as the owner typing', () => {
  it('ignores Orca mail and the message that started the chat', () => {
    expect(forkOwnerTypedAt({ at: 5_000_000, prompt: `${'─'.repeat(60)}\nFrom: x` }, 1)).toBeNull()
    expect(forkOwnerTypedAt({ at: 1_030_000, prompt: 'BAD-12: do it' }, 1_000_000)).toBeNull()
    expect(forkOwnerTypedAt(undefined, 1)).toBeNull()
  })

  it('counts a typed turn well after creation', () => {
    expect(forkOwnerTypedAt({ at: 9_000_000, prompt: 'actually, also...' }, 1_000_000)).toBe(
      9_000_000
    )
  })
})

describe('settings and text', () => {
  it('defaults on, 24 hours and 10 minutes, and ignores nonsense', () => {
    expect(forkBotChatAutoCloseEnabled({})).toBe(true)
    expect(forkBotChatAutoCloseEnabled({ forkBotChatAutoClose: false })).toBe(false)
    expect(forkBotChatAutoCloseIdleMs({})).toBe(24 * HOUR)
    expect(forkBotChatAutoCloseIdleMs({ forkBotChatAutoCloseIdleHours: 6 })).toBe(6 * HOUR)
    expect(forkBotChatAutoCloseIdleMs({ forkBotChatAutoCloseIdleHours: -1 })).toBe(24 * HOUR)
    expect(forkBotChatAutoCloseGraceMs({})).toBe(10 * MIN)
    expect(forkBotChatAutoCloseGraceMs({ forkBotChatAutoCloseGraceMinutes: 30 })).toBe(30 * MIN)
  })

  it('finds a card key in a title', () => {
    expect(forkBotChatCardKey('BAD-542: Merge PR 95 and deploy release')).toBe('BAD-542')
    expect(forkBotChatCardKey('Deploy BAD-718 now')).toBe('BAD-718')
    expect(forkBotChatCardKey('quick question')).toBeNull()
  })

  it('reads the outcome from the final reply', () => {
    expect(forkBotChatOutcome('Merged and deployed.')).toBe('done')
    expect(forkBotChatOutcome('The deploy failed on the lint step.')).toBe('failed')
    expect(forkBotChatOutcome('Blocked: needs a decision on the schema.')).toBe('blocked')
  })

  it('writes one compact ASCII row with the card and the chat id', () => {
    const row = forkBotChatClosedNote({
      title: 'BAD-12: Merge PR 95',
      chatId: 'abc',
      cardKey: 'BAD-12',
      cardUrl: 'https://example.test/BAD-12',
      outcome: 'done',
      reply: 'Merged.\nDeployed.'
    })
    expect(row).toBe(
      'Closed chat "BAD-12: Merge PR 95" (BAD-12 https://example.test/BAD-12) - done: Merged. Deployed. [chat:abc]'
    )
    expect(row).not.toMatch(/\n|[^\x20-\x7e]/)
  })
})
