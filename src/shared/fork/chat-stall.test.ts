import { describe, expect, it } from 'vitest'
import {
  forkChatStallAutoRelease,
  forkChatStallMinutes,
  isForkChatStallAction,
  normalizeForkChatStallEntries,
  pickForkChatStallSettings
} from './chat-stall'

describe('chat stall settings', () => {
  it('defaults to 30 minutes with auto release off', () => {
    expect(forkChatStallMinutes(undefined)).toBe(30)
    expect(forkChatStallAutoRelease(undefined)).toBe(false)
  })

  it('keeps 0 (off) and whole minutes up to a week; anything else reads as 30', () => {
    expect(forkChatStallMinutes({ forkChatStallMinutes: 0 })).toBe(0)
    expect(forkChatStallMinutes({ forkChatStallMinutes: 120 })).toBe(120)
    for (const bad of [-1, 1.5, 7 * 24 * 60 + 1, Number.NaN]) {
      expect(forkChatStallMinutes({ forkChatStallMinutes: bad })).toBe(30)
    }
  })

  it('turns auto release on only for true', () => {
    expect(forkChatStallAutoRelease({ forkChatStallAutoRelease: true })).toBe(true)
    expect(forkChatStallAutoRelease({ forkChatStallAutoRelease: false })).toBe(false)
  })

  it('picks only well-typed fields', () => {
    expect(
      pickForkChatStallSettings({ forkChatStallMinutes: '5', forkChatStallAutoRelease: true, x: 1 })
    ).toEqual({ forkChatStallAutoRelease: true })
    expect(pickForkChatStallSettings(null)).toEqual({})
  })
})

describe('chat stall wire values', () => {
  it('knows its actions', () => {
    expect(['interrupt', 'release', 'wake'].every(isForkChatStallAction)).toBe(true)
    expect(isForkChatStallAction('kill')).toBe(false)
  })

  it('drops malformed entries', () => {
    expect(
      normalizeForkChatStallEntries([
        { sessionId: 's1', quietSince: 5, liveness: 'stopped' },
        { sessionId: 's2', quietSince: 5, liveness: 'asleep' },
        { sessionId: 3, quietSince: 5, liveness: 'alive' },
        null
      ])
    ).toEqual([{ sessionId: 's1', quietSince: 5, liveness: 'stopped' }])
    expect(normalizeForkChatStallEntries('x')).toEqual([])
  })
})
