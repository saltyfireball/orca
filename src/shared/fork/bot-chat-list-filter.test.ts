// BAD-734: the chat list a client (the phone app included) is served leaves out closed chats.
import { describe, expect, it } from 'vitest'
import type { BotChatTreeChat } from '../bots/bot-chat-tree'
import { forkOlderBotChats, forkOpenBotChatTree } from './bot-chat-list-filter'

function chat(chatId: string, lastActiveAt: number, fields: Partial<BotChatTreeChat> = {}) {
  return {
    chatId,
    title: chatId,
    origin: 'side',
    live: 'idle',
    lastActiveAt,
    unread: false,
    closed: false,
    running: [],
    runningTotal: 0,
    finished: [],
    finishedTotal: 0,
    failedTotal: 0,
    ...fields
  } satisfies BotChatTreeChat
}

const tree = {
  chats: [
    chat('old-closed', 10, { closed: true }),
    chat('older-open', 20),
    chat('home', 5, { origin: 'home' }),
    chat('new-closed', 90, { closed: true }),
    chat('newer-open', 80),
    chat('replying', 1, { live: 'replying' })
  ],
  workspaceChats: { w1: 'home' }
}

describe('the list a client reads', () => {
  it('leaves closed chats out and orders the rest as the app does', () => {
    const served = forkOpenBotChatTree(tree)
    expect(served.chats.map((entry) => entry.chatId)).toEqual([
      'home',
      'replying',
      'newer-open',
      'older-open'
    ])
    expect(served.closedTotal).toBe(2)
    expect(served.workspaceChats).toEqual({ w1: 'home' })
  })

  it('omits the count when nothing was left out', () => {
    expect(forkOpenBotChatTree({ chats: [chat('a', 1)], workspaceChats: {} })).not.toHaveProperty(
      'closedTotal'
    )
  })

  it('pages the closed chats in, newest activity first', () => {
    const first = forkOlderBotChats(tree, { limit: 1 })
    expect(first.chats.map((entry) => entry.chatId)).toEqual(['new-closed'])
    expect(first).toMatchObject({ more: true, total: 2 })
    const next = forkOlderBotChats(tree, { limit: 1, before: first.chats[0].lastActiveAt })
    expect(next.chats.map((entry) => entry.chatId)).toEqual(['old-closed'])
    expect(next.more).toBe(false)
  })
})
