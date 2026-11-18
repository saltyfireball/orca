import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlackfishLiveActivityNative } from '../../../../modules/fork-live-activity/src/index'
import type { LiveAgentMemory } from './live-activity-model'
import { createLiveAgentPublisher } from './live-activity-publisher'
import {
  DEFAULT_LIVE_ACTIVITY_SETTINGS,
  loadLiveActivitySettings,
  parseLiveActivitySettings,
  saveLiveActivitySettings,
  subscribeLiveActivitySettings
} from './live-activity-settings'

const stored = vi.hoisted(() => new Map<string, string>())
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => stored.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      stored.set(key, value)
    })
  }
}))

function fakeNative(
  result: Awaited<ReturnType<BlackfishLiveActivityNative['syncActivity']>> = 'updated'
) {
  return {
    areActivitiesEnabled: vi.fn(() => true),
    syncActivity: vi.fn(async (_json: string, _staleAfterSeconds: number) => result),
    endActivity: vi.fn(async () => undefined),
    writeWidget: vi.fn((_json: string | null) => undefined)
  } satisfies BlackfishLiveActivityNative
}

const working: LiveAgentMemory = {
  rows: [
    {
      id: 'a:1',
      hostId: 'a',
      paneKey: '1',
      title: 'one',
      host: 'Studio',
      workspace: 'w',
      state: 'working',
      since: 1
    }
  ]
}

beforeEach(() => stored.clear())

describe('createLiveAgentPublisher', () => {
  it('sends a changed list once and skips an unchanged one', async () => {
    const native = fakeNative()
    const publisher = createLiveAgentPublisher(native)
    await publisher.publish(working, DEFAULT_LIVE_ACTIVITY_SETTINGS, 10)
    await publisher.publish(working, DEFAULT_LIVE_ACTIVITY_SETTINGS, 20)
    expect(native.syncActivity).toHaveBeenCalledTimes(1)
    expect(native.writeWidget).toHaveBeenCalledTimes(1)
    expect(JSON.parse(native.syncActivity.mock.calls[0]![0])).toMatchObject({
      working: 1,
      rows: [{ id: 'a:1' }]
    })
    expect(await createLiveAgentPublisher(native).load()).toEqual(working)
  })

  it('tries again after iOS refused to start the activity', async () => {
    const native = fakeNative('failed')
    const publisher = createLiveAgentPublisher(native)
    await publisher.publish(working, DEFAULT_LIVE_ACTIVITY_SETTINGS, 10)
    await publisher.publish(working, DEFAULT_LIVE_ACTIVITY_SETTINGS, 20)
    expect(native.syncActivity).toHaveBeenCalledTimes(2)
  })

  it('ends the activity and clears the widget once when both are turned off', async () => {
    const native = fakeNative()
    const publisher = createLiveAgentPublisher(native)
    const off = { ...DEFAULT_LIVE_ACTIVITY_SETTINGS, liveActivity: false, widget: false }
    await publisher.publish(working, off, 10)
    await publisher.publish(working, off, 20)
    expect(native.syncActivity).not.toHaveBeenCalled()
    expect(native.endActivity).toHaveBeenCalledTimes(1)
    expect(native.writeWidget).toHaveBeenCalledTimes(1)
    expect(native.writeWidget).toHaveBeenCalledWith(null)
  })
})

describe('live activity settings', () => {
  it('defaults on with 15 minutes and ignores unknown values', () => {
    expect(parseLiveActivitySettings(null)).toEqual({
      liveActivity: true,
      widget: true,
      keepFinishedMinutes: 15
    })
    expect(parseLiveActivitySettings('{"liveActivity":false,"keepFinishedMinutes":7}')).toEqual({
      liveActivity: false,
      widget: true,
      keepFinishedMinutes: 15
    })
  })

  it('saves, loads back and tells subscribers', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeLiveActivitySettings(listener)
    const next = { liveActivity: false, widget: true, keepFinishedMinutes: 30 } as const
    await saveLiveActivitySettings(next)
    unsubscribe()
    expect(listener).toHaveBeenCalledWith(next)
    expect(await loadLiveActivitySettings()).toEqual(next)
  })
})
