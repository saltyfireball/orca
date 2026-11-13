import { describe, expect, it } from 'vitest'
import {
  FORK_CHAT_SLEEP_DEFAULT_IDLE_MINUTES,
  FORK_CHAT_SLEEP_MAX_ON_SCREEN,
  forkChatSleepEnabled,
  forkChatSleepIdleMinutes,
  forkChatSleepKeepVisible,
  normalizeForkChatSleepOnScreen,
  pickForkChatSleepSettings
} from './chat-sleep'

describe('chat sleep settings', () => {
  it('is off unless switched on', () => {
    expect(forkChatSleepEnabled(undefined)).toBe(false)
    expect(forkChatSleepEnabled({})).toBe(false)
    expect(forkChatSleepEnabled({ forkChatSleep: true })).toBe(true)
  })

  it('reads idle minutes, falling back to 30 for anything odd', () => {
    expect(FORK_CHAT_SLEEP_DEFAULT_IDLE_MINUTES).toBe(30)
    expect(forkChatSleepIdleMinutes({})).toBe(30)
    expect(forkChatSleepIdleMinutes({ forkChatSleepIdleMinutes: 15 })).toBe(15)
    for (const bad of [0, -5, 1.5, Number.NaN, 7 * 24 * 60 + 1]) {
      expect(forkChatSleepIdleMinutes({ forkChatSleepIdleMinutes: bad })).toBe(30)
    }
  })

  it('keeps on-screen chats awake unless switched off', () => {
    expect(forkChatSleepKeepVisible({})).toBe(true)
    expect(forkChatSleepKeepVisible({ forkChatSleepKeepVisible: false })).toBe(false)
  })
})

describe('normalizeForkChatSleepOnScreen', () => {
  it('keeps distinct nonempty strings only', () => {
    expect(normalizeForkChatSleepOnScreen(['a', '', 'a', 3, null, 'b'])).toEqual(['a', 'b'])
    expect(normalizeForkChatSleepOnScreen('a')).toEqual([])
    expect(normalizeForkChatSleepOnScreen(['x'.repeat(513)])).toEqual([])
  })

  it('caps the list', () => {
    const ids = Array.from({ length: FORK_CHAT_SLEEP_MAX_ON_SCREEN + 10 }, (_, i) => `s${i}`)
    expect(normalizeForkChatSleepOnScreen(ids)).toHaveLength(FORK_CHAT_SLEEP_MAX_ON_SCREEN)
  })
})

describe('pickForkChatSleepSettings', () => {
  it('reads only well-typed chat sleep fields', () => {
    expect(
      pickForkChatSleepSettings({
        forkChatSleep: true,
        forkChatSleepIdleMinutes: 10,
        forkChatSleepKeepVisible: false,
        other: 1
      })
    ).toEqual({
      forkChatSleep: true,
      forkChatSleepIdleMinutes: 10,
      forkChatSleepKeepVisible: false
    })
    expect(
      pickForkChatSleepSettings({ forkChatSleep: 'yes', forkChatSleepIdleMinutes: '5' })
    ).toEqual({})
    expect(pickForkChatSleepSettings(null)).toEqual({})
    expect(pickForkChatSleepSettings(undefined)).toEqual({})
  })
})
