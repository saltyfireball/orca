import { describe, expect, it } from 'vitest'
import type { BotChatTreeChat } from '../bots/bot-chat-tree'
import { botSidebarListedChats } from '../bots/bot-sidebar-chat-groups'
import { forkBotChatRecent, forkListsTablessBotChat } from './bot-chat-listing'

const NOW = 10_000_000
const HOUR = 3_600_000

function chat(chatId: string, fields: Partial<BotChatTreeChat> = {}): BotChatTreeChat {
  return {
    chatId,
    title: chatId,
    origin: 'side',
    live: 'idle',
    lastActiveAt: NOW - 5 * 60_000,
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

const recent = { now: NOW, windowMs: HOUR }
const ids = (chats: BotChatTreeChat[]) => chats.map((c) => c.chatId)

describe('listing a chat with no open tab', () => {
  it('lists a side chat a handoff just started, as the open-tab rule alone would not', () => {
    const chats = [chat('home', { origin: 'home', tab: true }), chat('handed-off')]
    expect(ids(botSidebarListedChats(chats))).toEqual(['home'])
    expect(ids(botSidebarListedChats(chats, recent))).toEqual(['home', 'handed-off'])
  })

  it('lists a chat that is going or new to the owner however old it is', () => {
    const old = NOW - 30 * HOUR
    expect(
      forkListsTablessBotChat(chat('a', { live: 'replying', lastActiveAt: old }), recent)
    ).toBe(true)
    expect(
      forkListsTablessBotChat(chat('b', { live: 'needs-you', lastActiveAt: old }), recent)
    ).toBe(true)
    expect(forkListsTablessBotChat(chat('c', { runningTotal: 1, lastActiveAt: old }), recent)).toBe(
      true
    )
    expect(forkListsTablessBotChat(chat('d', { unseen: true, lastActiveAt: old }), recent)).toBe(
      true
    )
  })

  it('leaves out an idle chat past the window, an ended chat and a tabless Home', () => {
    expect(forkListsTablessBotChat(chat('idle', { lastActiveAt: NOW - 2 * HOUR }), recent)).toBe(
      false
    )
    expect(forkListsTablessBotChat(chat('ended', { closed: true, live: 'replying' }), recent)).toBe(
      false
    )
    expect(forkListsTablessBotChat(chat('home', { origin: 'home' }), recent)).toBe(false)
    expect(
      ids(botSidebarListedChats([chat('idle', { lastActiveAt: NOW - 2 * HOUR })], recent))
    ).toEqual([])
  })

  it('keeps a chat with an open tab as before, and an older host that reports no tab', () => {
    const chats = [chat('open', { tab: true }), chat('older', { tab: undefined })]
    expect(ids(botSidebarListedChats(chats, recent))).toEqual(['open', 'older'])
  })
})

describe('forkBotChatRecent', () => {
  it('defaults to an hour, reads minutes, and is off at 0', () => {
    expect(forkBotChatRecent(undefined, NOW)).toEqual({ now: NOW, windowMs: HOUR })
    expect(forkBotChatRecent({ forkBotChatRecentMinutes: 15 }, NOW)?.windowMs).toBe(15 * 60_000)
    expect(forkBotChatRecent({ forkBotChatRecentMinutes: 0 }, NOW)).toBeNull()
    expect(forkBotChatRecent({ forkBotChatRecentMinutes: -3 }, NOW)?.windowMs).toBe(HOUR)
  })
})
