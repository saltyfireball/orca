import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startForkBackoffTimer } from './fork-backoff-timer'

describe('startForkBackoffTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs at the base cadence while each run has work', async () => {
    const run = vi.fn().mockResolvedValue(true)
    const stop = startForkBackoffTimer({ run, baseMs: 1_000, maxMs: 8_000 })
    await vi.advanceTimersByTimeAsync(999)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(run).toHaveBeenCalledTimes(4)
    stop()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(run).toHaveBeenCalledTimes(4)
  })

  it('doubles the wait while idle, up to the cap, and returns to base on work', async () => {
    let hadWork = false
    const at: number[] = []
    const run = vi.fn(async () => {
      at.push(Date.now())
      return hadWork
    })
    const start = Date.now()
    startForkBackoffTimer({ run, baseMs: 1_000, maxMs: 4_000 })
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000 + 4_000)
    expect(at.map((time) => time - start)).toEqual([1_000, 3_000, 7_000, 11_000])
    hadWork = true
    await vi.advanceTimersByTimeAsync(4_000)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(at.map((time) => time - start)).toEqual([1_000, 3_000, 7_000, 11_000, 15_000, 16_000])
  })

  it('reports a failing run and keeps the base cadence', async () => {
    const onError = vi.fn()
    const run = vi.fn().mockRejectedValue(new Error('boom'))
    startForkBackoffTimer({ run, baseMs: 100, maxMs: 1_000, onError })
    await vi.advanceTimersByTimeAsync(200)
    expect(run).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledTimes(2)
  })
})
