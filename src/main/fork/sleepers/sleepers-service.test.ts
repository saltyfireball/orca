// Sleepers (FORK.md): sleep now refuses what the idle sweep would refuse and reports what
// really happened.
import { describe, expect, it, vi } from 'vitest'
import { sleepChatNow, sleepChatsNow, type ForkSleepChatState } from './sleepers-service'

function deps(states: Record<string, ForkSleepChatState>, stopOnSweep = true) {
  const live = new Map(Object.entries(states))
  const sweepNow = vi.fn(async (id: string) => {
    const state = live.get(id)
    if (state && stopOnSweep) {
      live.set(id, { ...state, processAlive: false })
    }
  })
  return {
    chatState: (id: string) => live.get(id) ?? { known: false, processAlive: false, busy: false },
    sweepNow
  }
}

const idle: ForkSleepChatState = { known: true, processAlive: true, busy: false }

describe('sleepChatNow', () => {
  it('sleeps an idle chat through the sweep and confirms the provider stopped', async () => {
    const d = deps({ s1: idle })
    expect(await sleepChatNow(d, 's1')).toBe('asleep')
    expect(d.sweepNow).toHaveBeenCalledWith('s1')
  })

  it('never runs the sweep on a busy, asleep or unknown chat', async () => {
    const d = deps({
      busy: { known: true, processAlive: true, busy: true },
      asleep: { known: true, processAlive: false, busy: false }
    })
    expect(await sleepChatNow(d, 'busy')).toBe('busy')
    expect(await sleepChatNow(d, 'asleep')).toBe('already-asleep')
    expect(await sleepChatNow(d, 'nope')).toBe('not-found')
    expect(d.sweepNow).not.toHaveBeenCalled()
  })

  it('reports busy when the sweep found owed work and left the provider running', async () => {
    const d = deps({ s1: idle }, false)
    expect(await sleepChatNow(d, 's1')).toBe('busy')
    expect(d.sweepNow).toHaveBeenCalledOnce()
  })

  it('reports busy when the sweep throws', async () => {
    const d = {
      chatState: () => idle,
      sweepNow: vi.fn(async () => {
        throw new Error('x')
      })
    }
    expect(await sleepChatNow(d, 's1')).toBe('busy')
  })

  it('is unavailable without a chat host or a sweep', async () => {
    expect(await sleepChatNow({ chatState: () => null, sweepNow: vi.fn() }, 's1')).toBe(
      'unavailable'
    )
    expect(await sleepChatNow({ chatState: () => idle, sweepNow: null }, 's1')).toBe('unavailable')
  })
})

describe('sleepChatsNow', () => {
  it('runs one chat at a time and reports each', async () => {
    let running = 0
    let most = 0
    const live = new Map([
      ['a', { ...idle }],
      ['b', { ...idle, busy: true }],
      ['c', { ...idle }]
    ])
    const d = {
      chatState: (id: string) => live.get(id) ?? null,
      sweepNow: async (id: string) => {
        running += 1
        most = Math.max(most, running)
        await new Promise((resolve) => setTimeout(resolve, 0))
        live.set(id, { ...live.get(id)!, processAlive: false })
        running -= 1
      }
    }
    expect(await sleepChatsNow(d, ['a', 'b', 'c'])).toEqual([
      { sessionId: 'a', result: 'asleep' },
      { sessionId: 'b', result: 'busy' },
      { sessionId: 'c', result: 'asleep' }
    ])
    expect(most).toBe(1)
  })
})
