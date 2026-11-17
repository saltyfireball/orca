// The fork's installs on a host with no desktop app, on fakes: no timer fires and no chat is read.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installForkHeadlessHost } from './headless-host'
import {
  forkIsHeadlessSettingsHost,
  forkMarkHeadlessSettingsHost
} from './settings-cli/settings-cli-headless'

afterEach(() => {
  forkMarkHeadlessSettingsHost(false)
  vi.useRealTimers()
})

describe('installForkHeadlessHost', () => {
  it('marks the host for settings writes and watches the store for the compaction mode', () => {
    vi.useFakeTimers()
    const listeners: ((updates: Record<string, unknown>) => void)[] = []
    const getSettings = vi.fn(() => ({}))
    const store = {
      getSettings,
      onSettingsChanged: (listener: (updates: Record<string, unknown>) => void) => {
        listeners.push(listener)
      }
    }
    expect(forkIsHeadlessSettingsHost()).toBe(false)

    const stop = installForkHeadlessHost(store)

    expect(forkIsHeadlessSettingsHost()).toBe(true)
    expect(listeners).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(1)
    // Nothing is read until the first sweep is due.
    expect(getSettings).not.toHaveBeenCalled()
    stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
