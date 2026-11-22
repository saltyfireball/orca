// BAD-734: mail for a chat Orca closed reopens it; a chat the owner closed stays closed.
import { describe, expect, it, vi } from 'vitest'
import { autoClosedChatKey } from './bot-chat-auto-closed-registry'
import { reopenAutoClosedBotChat, type BotChatReopenDeps } from './bot-chat-reopen'

function deps(autoClosed: string[], over: Partial<BotChatReopenDeps> = {}) {
  const shown: string[] = []
  const forgotten: string[] = []
  const value: BotChatReopenDeps = {
    rootOf: (id) => (id === 'after-clear' ? 'root' : id),
    isAutoClosed: async (id) => autoClosed.includes(id),
    show: async (id) => void shown.push(id),
    forget: async (id) => void forgotten.push(id),
    ...over
  }
  return { value, shown, forgotten }
}

describe('reopening on mail', () => {
  it('reopens a chat Orca closed, by address, chat id or a /clear alias', async () => {
    const d = deps(['root'])
    expect(await reopenAutoClosedBotChat(d.value, 'orca_session_id:root')).toBe(true)
    expect(await reopenAutoClosedBotChat(d.value, 'chat:root')).toBe(true)
    expect(await reopenAutoClosedBotChat(d.value, 'after-clear')).toBe(true)
    expect(d.shown).toEqual(['root', 'root', 'root'])
    expect(d.forgotten).toEqual(['root', 'root', 'root'])
  })

  it('leaves a chat the owner closed, and any other, alone', async () => {
    const d = deps(['root'])
    expect(await reopenAutoClosedBotChat(d.value, 'orca_session_id:by-hand')).toBe(false)
    expect(d.shown).toEqual([])
  })

  it('keeps the chat on the list when it could not be shown, so the next mail tries again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const d = deps(['root'], {
      show: async () => {
        throw new Error('store busy')
      }
    })
    expect(await reopenAutoClosedBotChat(d.value, 'root')).toBe(false)
    expect(d.forgotten).toEqual([])
  })

  it('names the chat id the same way for every spelling', () => {
    expect(autoClosedChatKey('orca_session_id:abc')).toBe('abc')
    expect(autoClosedChatKey('chat:abc')).toBe('abc')
    expect(autoClosedChatKey('abc')).toBe('abc')
  })
})
