import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_QUICK_TASK_SETTINGS,
  loadQuickTaskSettings,
  parseQuickTaskSettings,
  saveQuickTaskSettings,
  subscribeQuickTaskSettings
} from './quick-task-settings'

const stored = vi.hoisted(() => new Map<string, string>())
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => stored.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      stored.set(key, value)
    })
  }
}))

describe('quick task settings', () => {
  beforeEach(() => stored.clear())

  it('shows the button by default', async () => {
    expect(DEFAULT_QUICK_TASK_SETTINGS.showEntry).toBe(true)
    await expect(loadQuickTaskSettings()).resolves.toEqual({ showEntry: true })
  })

  it('falls back to the default on bad or partial data', () => {
    expect(parseQuickTaskSettings('not json')).toEqual(DEFAULT_QUICK_TASK_SETTINGS)
    expect(parseQuickTaskSettings('null')).toEqual(DEFAULT_QUICK_TASK_SETTINGS)
    expect(parseQuickTaskSettings('{"showEntry":"no"}')).toEqual(DEFAULT_QUICK_TASK_SETTINGS)
    expect(parseQuickTaskSettings('{"showEntry":false}')).toEqual({ showEntry: false })
  })

  it('saves, reloads and tells listeners', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeQuickTaskSettings(listener)
    await saveQuickTaskSettings({ showEntry: false })
    expect(listener).toHaveBeenCalledWith({ showEntry: false })
    await expect(loadQuickTaskSettings()).resolves.toEqual({ showEntry: false })
    unsubscribe()
    await saveQuickTaskSettings({ showEntry: true })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
