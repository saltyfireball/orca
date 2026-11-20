// BAD-669: closing a bot's chat from the sidebar.
import { describe, expect, it, vi } from 'vitest'
import type { BotChatTreeChat } from '../../../shared/bots/bot-chat-tree'
import { closeForkBotChat } from './bot-chat-close'

function chat(chatId: string, fields: Partial<BotChatTreeChat> = {}): BotChatTreeChat {
  return {
    chatId,
    title: chatId,
    origin: 'side',
    live: 'idle',
    lastActiveAt: 0,
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

function deps(chats: BotChatTreeChat[] | null, stopped = true) {
  const closeSession = vi.fn(async () => ({ stopped, reason: stopped ? undefined : 'busy' }))
  return { closeSession, readChats: async () => chats }
}

describe('closeForkBotChat', () => {
  it('closes a side chat of the bot', async () => {
    const d = deps([chat('s1')])
    expect(await closeForkBotChat(d, { botId: 'b', chatId: 's1' })).toEqual({ closed: true })
    expect(d.closeSession).toHaveBeenCalledWith('s1')
  })

  it('never closes the Home Chat, whatever the client asks', async () => {
    const d = deps([chat('h', { origin: 'home' })])
    expect(await closeForkBotChat(d, { botId: 'b', chatId: 'h' })).toEqual({
      closed: false,
      reason: 'home'
    })
    expect(d.closeSession).not.toHaveBeenCalled()
  })

  it("refuses a chat that is not the bot's, and a run listed as a chat", async () => {
    const d = deps([chat('r', { run: { automationId: 'a', runId: 'x' } })])
    expect(await closeForkBotChat(d, { botId: 'b', chatId: 'other' })).toMatchObject({
      reason: 'not-found'
    })
    expect(await closeForkBotChat(d, { botId: 'b', chatId: 'r' })).toMatchObject({
      reason: 'not-a-chat'
    })
    expect(d.closeSession).not.toHaveBeenCalled()
  })

  it('treats a chat that is already closed as closed, and reports a close that failed', async () => {
    const done = deps([chat('c', { closed: true })])
    expect(await closeForkBotChat(done, { botId: 'b', chatId: 'c' })).toEqual({ closed: true })
    expect(done.closeSession).not.toHaveBeenCalled()
    const failing = deps([chat('s')], false)
    expect(await closeForkBotChat(failing, { botId: 'b', chatId: 's' })).toEqual({
      closed: false,
      reason: 'failed',
      detail: 'busy'
    })
  })
})
