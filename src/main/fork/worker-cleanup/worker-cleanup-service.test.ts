import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'
import type { WorkerTerminalReleaseRuntime } from '../../runtime/orchestration/terminal-authority/release/worker-terminal-release-runtime'
import { FORK_WORKER_CLEANUP_SWEEP_MS, installForkWorkerCleanup } from './worker-cleanup-service'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('worker cleanup sweep timer', () => {
  it('backs off while the setting is off and starts over when the setting changes', async () => {
    let listener: ((updates: Partial<ForkGlobalSettings>) => void) | null = null
    const getSettings = vi.fn(() => ({}))
    installForkWorkerCleanup({} as WorkerTerminalReleaseRuntime, {
      getSettings,
      getRepos: () => [],
      onSettingsChanged: (next) => {
        listener = next
      }
    })
    // First sweep one interval in; the setting is off, so the next wait doubles.
    await vi.advanceTimersByTimeAsync(FORK_WORKER_CLEANUP_SWEEP_MS)
    expect(getSettings).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(FORK_WORKER_CLEANUP_SWEEP_MS)
    expect(getSettings).toHaveBeenCalledTimes(1)
    // A change of the setting is seen within one interval, as with a fixed timer.
    listener!({ forkWorkerCleanup: false })
    await vi.advanceTimersByTimeAsync(FORK_WORKER_CLEANUP_SWEEP_MS)
    expect(getSettings).toHaveBeenCalledTimes(2)
    // Other settings leave the backed-off wait alone.
    listener!({ forkChatSurvive: true })
    await vi.advanceTimersByTimeAsync(FORK_WORKER_CLEANUP_SWEEP_MS)
    expect(getSettings).toHaveBeenCalledTimes(2)
  })
})
