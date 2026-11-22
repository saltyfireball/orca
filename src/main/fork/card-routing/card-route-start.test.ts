import { afterEach, describe, expect, it, vi } from 'vitest'
import { shortHostName, startCardChat, type CardRouteStartDeps } from './card-route-start'

const pause = vi.hoisted(() => ({ engaged: false }))
vi.mock('../pause-all/pause-all-state', () => ({
  isForkPauseAllEngaged: () => pause.engaged,
  forkPauseAllRefusal: () => (pause.engaged ? 'Paused by pause-all: test' : null),
  onForkPauseAllChanged: () => () => {}
}))
afterEach(() => {
  pause.engaged = false
})

type B = { id: string; name: string; paused: boolean }

function deps(bots: B[], over: Partial<CardRouteStartDeps<B>> = {}) {
  return {
    botsEnabled: () => true,
    listBots: () => bots,
    startChat: vi.fn(async () => 'chat-1'),
    nameChat: vi.fn(async () => {}),
    machine: () => 'deskmac',
    ...over
  } satisfies CardRouteStartDeps<B>
}

const PARAMS = { bot: 'writer', subject: 'ABC-1: Fix it', message: 'Linear card ABC-1' }

describe('startCardChat', () => {
  it('starts nothing while pause-all is engaged (BAD-685)', async () => {
    const d = deps([{ id: 'b1', name: 'Writer', paused: false }])
    pause.engaged = true
    await expect(startCardChat(d, PARAMS)).rejects.toThrow('Paused by pause-all')
    expect(d.startChat).not.toHaveBeenCalled()
  })

  it('starts the named bot, titles the chat with the card, and says where it runs', async () => {
    const d = deps([{ id: 'b1', name: 'Writer', paused: false }])
    await expect(startCardChat(d, PARAMS)).resolves.toEqual({
      bot: 'Writer',
      chatId: 'chat-1',
      machine: 'deskmac'
    })
    expect(d.startChat).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b1' }),
      'Linear card ABC-1'
    )
    expect(d.nameChat).toHaveBeenCalledWith('chat-1', 'ABC-1: Fix it')
  })

  it('keeps the chat id when the title fails', async () => {
    const d = deps([{ id: 'b1', name: 'Writer', paused: false }], {
      nameChat: vi.fn(async () => {
        throw new Error('host busy')
      })
    })
    await expect(startCardChat(d, PARAMS)).resolves.toMatchObject({ chatId: 'chat-1' })
  })

  it('refuses a missing or paused bot before starting anything', async () => {
    const none = deps([])
    await expect(startCardChat(none, PARAMS)).rejects.toThrow('No bot named writer on deskmac')
    const paused = deps([{ id: 'b1', name: 'Writer', paused: true }])
    await expect(startCardChat(paused, PARAMS)).rejects.toThrow('Writer is paused')
    expect(paused.startChat).not.toHaveBeenCalled()
  })
})

describe('shortHostName', () => {
  it('drops the .local a Mac adds', () => {
    expect(shortHostName('desk.local')).toBe('desk')
    expect(shortHostName('buildbox')).toBe('buildbox')
  })
})
