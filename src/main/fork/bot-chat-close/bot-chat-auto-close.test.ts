// BAD-734: the pass over a host's bots: the sweep of existing chats, the dry run, the Home Chat row.
import { describe, expect, it, vi } from 'vitest'
import type { BotChatTreeChat } from '../../../shared/bots/bot-chat-tree'
import type { ForkBotChatCardState } from '../../../shared/fork/bot-chat-auto-close'
import { formatBotChatCleanup } from '../../../cli/fork/bot-chat-cleanup-handlers'
import {
  runBotChatAutoClosePass,
  type AutoCloseBot,
  type AutoCloseChatReads,
  type BotChatAutoCloseDeps
} from './bot-chat-auto-close'
import { messageTimeMs } from './bot-chat-auto-close-service'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = 1_000 * HOUR

const BOT: AutoCloseBot = { id: 'b1', name: 'Router', homeChatId: 'home-chat' }

function chat(
  chatId: string,
  title: string,
  fields: Partial<BotChatTreeChat> = {}
): BotChatTreeChat {
  return {
    chatId,
    title,
    origin: 'side',
    live: 'idle',
    lastActiveAt: NOW - 30 * MIN,
    unread: false,
    closed: false,
    running: [],
    runningTotal: 0,
    finished: [],
    finishedTotal: 0,
    failedTotal: 0,
    ...fields
  }
}

const reads = (fields: Partial<AutoCloseChatReads> = {}): AutoCloseChatReads => ({
  autoStarted: false,
  queued: false,
  openItem: false,
  ownerTypedAt: null,
  lastInboundAt: null,
  reportedBackAt: null,
  ...fields
})

/** Fixtures: a bot with the chats it piles up. */
const CHATS = [
  chat('home-chat', 'Home Chat', { origin: 'home', lastActiveAt: NOW - 90 * HOUR }),
  chat('card-done', 'BAD-732: Route the Linear card'),
  chat('answered', 'Deploy release 1d', { preview: 'Deployed and verified.' }),
  chat('stale', 'Look at the logs', { lastActiveAt: NOW - 30 * HOUR }),
  chat('card-open', 'BAD-900: Still being worked'),
  chat('asking', 'BAD-733: Needs a decision', { live: 'needs-you' }),
  chat('typed', 'BAD-734: John is in here'),
  chat('shut', 'BAD-1: already closed', { closed: true })
]

const FACTS: Record<string, AutoCloseChatReads> = {
  'card-done': reads({ autoStarted: true }),
  answered: reads({
    autoStarted: true,
    lastInboundAt: NOW - 3 * HOUR,
    reportedBackAt: NOW - 2 * HOUR
  }),
  stale: reads(),
  'card-open': reads({ autoStarted: true }),
  asking: reads({ autoStarted: true }),
  typed: reads({ ownerTypedAt: NOW - 2 * HOUR })
}

const CARDS: Record<string, ForkBotChatCardState> = {
  'BAD-732': 'done',
  'BAD-900': 'open',
  'BAD-733': 'done',
  'BAD-734': 'canceled',
  'BAD-1': 'done'
}

function deps(over: Partial<BotChatAutoCloseDeps> = {}): BotChatAutoCloseDeps & {
  closed: string[]
  notes: string[]
} {
  const closed: string[] = []
  const notes: string[] = []
  return {
    now: () => NOW,
    settings: {},
    bots: () => [BOT],
    readChats: async () => CHATS,
    readFacts: async (_bot, entry) => FACTS[entry.chatId] ?? reads(),
    cardState: async (key) => ({
      state: CARDS[key] ?? 'unknown',
      url: `https://tracker.test/${key}`
    }),
    close: async (_bot, entry) => {
      closed.push(entry.chatId)
      return { closed: true }
    },
    noteInHome: (_bot, text) => notes.push(text),
    ...over,
    closed,
    notes
  }
}

describe('the one-time sweep of existing chats', () => {
  it('closes the finished ones and keeps the rest', async () => {
    const d = deps()
    const rows = await runBotChatAutoClosePass(d, { dryRun: false })
    expect(rows.map((row) => [row.chatId, row.outcome, row.reason])).toEqual([
      ['card-done', 'closed', 'card-finished'],
      ['answered', 'closed', 'job-ended'],
      ['stale', 'closed', 'idle']
    ])
    expect(d.closed).toEqual(['card-done', 'answered', 'stale'])
  })

  it('leaves the Home Chat, an open card, a waiting chat and one the owner typed in', async () => {
    const d = deps()
    const rows = await runBotChatAutoClosePass(d, { dryRun: false, includeKept: true })
    const kept = Object.fromEntries(
      rows.filter((row) => row.outcome === 'kept').map((row) => [row.chatId, row.keep])
    )
    expect(kept).toEqual({ 'card-open': 'in-use', asking: 'needs-you', typed: 'owner-typed' })
    expect(d.closed).not.toContain('home-chat')
  })
})

describe('the Home Chat row', () => {
  it('is one compact row per auto-started chat, none for an owner-started one', async () => {
    const d = deps()
    await runBotChatAutoClosePass(d, { dryRun: false })
    expect(d.notes).toHaveLength(2)
    expect(d.notes[0]).toContain('BAD-732')
    expect(d.notes[0]).toContain('https://tracker.test/BAD-732')
    expect(d.notes[0]).toContain('[chat:card-done]')
    expect(d.notes[1]).toContain('Deploy release 1d')
    expect(d.notes[1]).toContain('done: Deployed and verified.')
    expect(d.notes.join('\n')).not.toContain('Look at the logs')
  })

  it('writes nothing for a chat that failed to close', async () => {
    const d = deps({ close: async () => ({ closed: false, detail: 'failed' }) })
    const rows = await runBotChatAutoClosePass(d, { dryRun: false })
    expect(rows.every((row) => row.outcome === 'failed')).toBe(true)
    expect(d.notes).toEqual([])
  })
})

describe('a dry run', () => {
  it('lists what would close and why, and closes and writes nothing', async () => {
    const d = deps()
    const rows = await runBotChatAutoClosePass(d, { dryRun: true })
    expect(d.closed).toEqual([])
    expect(d.notes).toEqual([])
    const text = formatBotChatCleanup({ dryRun: true, enabled: true, rows, servers: [] })
    expect(text).toBe(
      [
        'would close  Router  card-done  BAD-732: Route the Linear card  (its card is done or canceled)',
        'would close  Router  answered  Deploy release 1d  (it finished and reported back)',
        'would close  Router  stale  Look at the logs  (it has been idle too long)',
        'Dry run: 3 would close. Nothing was changed.'
      ].join('\n')
    )
  })

  it('limits itself to the bot named', async () => {
    const d = deps()
    expect(await runBotChatAutoClosePass(d, { dryRun: true, bot: 'someone-else' })).toEqual([])
    expect(await runBotChatAutoClosePass(d, { dryRun: true, bot: 'router' })).toHaveLength(3)
  })

  it('treats an unreadable card as not finished', async () => {
    const d = deps({
      cardState: async () => {
        throw new Error('Linear is down')
      }
    })
    const rows = await runBotChatAutoClosePass(d, { dryRun: true })
    expect(rows.map((row) => row.chatId)).toEqual(['answered', 'stale'])
  })
})

describe('message times', () => {
  it('reads SQLite UTC text and ISO text alike', () => {
    expect(messageTimeMs('2026-11-22 10:00:00')).toBe(Date.UTC(2026, 10, 22, 10))
    expect(messageTimeMs('2026-11-22T10:00:00.000Z')).toBe(Date.UTC(2026, 10, 22, 10))
    expect(messageTimeMs(null)).toBeNull()
    expect(messageTimeMs('nonsense')).toBeNull()
  })
})

vi.setConfig({ testTimeout: 5_000 })
