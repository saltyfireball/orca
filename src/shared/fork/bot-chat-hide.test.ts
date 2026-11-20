// BAD-669: hiding a bot's chat from the sidebar, and when it comes back.
import { describe, expect, it } from 'vitest'
import type { BotChatTreeChat, BotChatTreeWorker } from '../bots/bot-chat-tree'
import { botSidebarListedChats } from '../bots/bot-sidebar-chat-groups'
import { forkBotChatRecent } from './bot-chat-listing'
import {
  FORK_BOT_HIDDEN_CHATS_MAX,
  forkBotChatCanDismiss,
  forkBotChatHiddenIds,
  forkBotFinishedChatIds,
  forkBotHiddenChatsWith,
  forkBotHiddenChatsWithout
} from './bot-chat-hide'

const NOW = 10_000_000

function chat(chatId: string, fields: Partial<BotChatTreeChat> = {}): BotChatTreeChat {
  return {
    chatId,
    title: chatId,
    origin: 'side',
    live: 'idle',
    lastActiveAt: NOW - 60_000,
    unread: false,
    closed: false,
    tab: false,
    running: [],
    runningTotal: 0,
    finished: [],
    finishedTotal: 0,
    failedTotal: 0,
    ...fields
  }
}

function worker(state: BotChatTreeWorker['state']): BotChatTreeWorker {
  return { key: 'w', title: 'w', state, startedAt: 0 }
}

const listed = (chats: BotChatTreeChat[], hidden: ReadonlySet<string>) =>
  botSidebarListedChats(chats, forkBotChatRecent({}, NOW, hidden)).map((entry) => entry.chatId)

describe('hiding a chat', () => {
  it('takes a chat out of the sidebar list, tab or not, and keeps the others', () => {
    const chats = [chat('a'), chat('b', { tab: true }), chat('c')]
    const { hidden } = forkBotChatHiddenIds(chats, { a: NOW - 1, b: NOW - 1 })
    expect(listed(chats, hidden)).toEqual(['c'])
  })

  it('works with the recent window turned off, which lists tabs only', () => {
    const chats = [chat('a', { tab: true }), chat('b', { tab: true })]
    const { hidden } = forkBotChatHiddenIds(chats, { a: NOW })
    const recent = forkBotChatRecent({ forkBotChatRecentMinutes: 0 }, NOW, hidden)
    expect(botSidebarListedChats(chats, recent).map((entry) => entry.chatId)).toEqual(['b'])
  })

  it('never hides the Home Chat, a closed chat or a run listed as a chat', () => {
    const chats = [
      chat('home', { origin: 'home', tab: true }),
      chat('done', { closed: true }),
      chat('run', { run: { automationId: 'a', runId: 'r' } })
    ]
    expect(chats.map(forkBotChatCanDismiss)).toEqual([false, false, false])
    expect(forkBotChatHiddenIds(chats, { home: 1, done: 1, run: 1 }).hidden.size).toBe(0)
  })
})

describe('a hidden chat coming back', () => {
  it('lists again when it needs the owner, and says so, so the hide is cleared', () => {
    const hiddenAt = NOW - 1_000
    for (const needs of [
      chat('q', { live: 'needs-you' }),
      chat('q', { running: [worker('needs-you')], runningTotal: 1 }),
      chat('q', { unread: true, turnDone: { paneKey: 'p', at: NOW } })
    ]) {
      const view = forkBotChatHiddenIds([needs], { q: hiddenAt })
      expect(view.hidden.size).toBe(0)
      expect(view.reappeared).toEqual(['q'])
    }
  })

  it('stays hidden while it only runs, replies or finished before it was hidden', () => {
    const hiddenAt = NOW - 1_000
    for (const quiet of [
      chat('q', { live: 'replying', runningTotal: 1, running: [worker('running')] }),
      chat('q', { unread: true, turnDone: { paneKey: 'p', at: hiddenAt - 5_000 } }),
      chat('q', { lastActiveAt: NOW })
    ]) {
      const view = forkBotChatHiddenIds([quiet], { q: hiddenAt })
      expect([...view.hidden]).toEqual(['q'])
      expect(view.reappeared).toEqual([])
    }
  })
})

describe('Hide finished chats', () => {
  it('picks finished side chats only', () => {
    const chats = [
      chat('idle'),
      chat('home', { origin: 'home' }),
      chat('replying', { live: 'replying' }),
      chat('waiting', { live: 'needs-you' }),
      chat('workers', { runningTotal: 2 }),
      chat('already'),
      chat('closed', { closed: true })
    ]
    expect(forkBotFinishedChatIds(chats, new Set(['already']))).toEqual(['idle'])
  })
})

describe('the stored map', () => {
  it('adds and removes ids and keeps the newest past the cap', () => {
    const added = forkBotHiddenChatsWith({ a: 1 }, ['b', 'c'], 5)
    expect(added).toEqual({ a: 1, b: 5, c: 5 })
    expect(forkBotHiddenChatsWithout(added, ['a', 'zzz'])).toEqual({ b: 5, c: 5 })
    const many = Object.fromEntries(
      Array.from({ length: FORK_BOT_HIDDEN_CHATS_MAX }, (_, index) => [`old${index}`, index])
    )
    const capped = forkBotHiddenChatsWith(many, ['fresh'], 10_000)
    expect(Object.keys(capped)).toHaveLength(FORK_BOT_HIDDEN_CHATS_MAX)
    expect(capped.fresh).toBe(10_000)
    expect(capped.old0).toBeUndefined()
  })
})
