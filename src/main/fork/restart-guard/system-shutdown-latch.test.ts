import { describe, expect, it } from 'vitest'
import { SYSTEM_SHUTDOWN_LATCH_MS, createSystemShutdownLatch } from './system-shutdown-latch'

describe('createSystemShutdownLatch', () => {
  function setup() {
    const timers: { run: () => void; ms: number; cancelled: boolean }[] = []
    const latch = createSystemShutdownLatch((run, ms) => {
      const timer = { run, ms, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    })
    return { latch, timers }
  }

  it('clears itself a minute after a shutdown that never quit', () => {
    const { latch, timers } = setup()
    latch.mark()
    expect(latch.isSet()).toBe(true)
    expect(timers[0]?.ms).toBe(SYSTEM_SHUTDOWN_LATCH_MS)
    timers[0]?.run()
    expect(latch.isSet()).toBe(false)
  })

  it('clears on resume and cancels its timer', () => {
    const { latch, timers } = setup()
    latch.mark()
    latch.reset()
    expect(latch.isSet()).toBe(false)
    expect(timers[0]?.cancelled).toBe(true)
  })

  it('restarts the minute on a second shutdown notice', () => {
    const { latch, timers } = setup()
    latch.mark()
    latch.mark()
    expect(timers[0]?.cancelled).toBe(true)
    expect(latch.isSet()).toBe(true)
  })
})
