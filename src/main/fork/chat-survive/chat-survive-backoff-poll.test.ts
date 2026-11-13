import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatSurviveBackoffPoll } from './chat-survive-backoff-poll'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('chatSurviveBackoffPoll', () => {
  it('looks at doubling gaps up to the cap and stops once the check says done', () => {
    const at: number[] = []
    let done = false
    chatSurviveBackoffPoll(
      () => {
        at.push(Date.now())
        return done
      },
      100,
      400
    )
    const start = Date.now()
    vi.advanceTimersByTime(100 + 200 + 400 + 400)
    expect(at.map((t) => t - start)).toEqual([100, 300, 700, 1100])
    done = true
    vi.advanceTimersByTime(400)
    expect(at).toHaveLength(5)
    vi.advanceTimersByTime(10_000)
    expect(at).toHaveLength(5)
  })

  it('never looks again after stop', () => {
    const check = vi.fn(() => false)
    const stop = chatSurviveBackoffPoll(check, 100, 1_000)
    vi.advanceTimersByTime(100)
    expect(check).toHaveBeenCalledTimes(1)
    stop()
    vi.advanceTimersByTime(10_000)
    expect(check).toHaveBeenCalledTimes(1)
  })
})
