import { describe, expect, it } from 'vitest'
import {
  decideWorkerRetry,
  resolveWorkerRetryPolicy,
  workerRetryDelayMs,
  type WorkerRetryInput
} from './worker-retry'

const on = resolveWorkerRetryPolicy({ forkWorkerRetry: true }, null)

function input(overrides: Partial<WorkerRetryInput>): WorkerRetryInput {
  return {
    policy: on,
    stop: { reason: 'exited' },
    attemptsUsed: 0,
    workerReported: false,
    taskStatus: 'dispatched',
    ...overrides
  }
}

describe('resolveWorkerRetryPolicy', () => {
  it('is off by default with 2 retries, 30 seconds and a 5 minute cap', () => {
    expect(resolveWorkerRetryPolicy(undefined, null)).toEqual({
      enabled: false,
      max: 2,
      backoffMs: 30_000,
      maxBackoffMs: 300_000
    })
  })

  it('lets a Run override the setting either way', () => {
    expect(
      resolveWorkerRetryPolicy(
        { forkWorkerRetry: true },
        { enabled: false, max: null, backoffSeconds: null }
      ).enabled
    ).toBe(false)
    expect(
      resolveWorkerRetryPolicy({}, { enabled: true, max: 4, backoffSeconds: 5 })
    ).toMatchObject({
      enabled: true,
      max: 4,
      backoffMs: 5000
    })
  })

  it('is off when the limit is 0 and clamps wild values', () => {
    expect(
      resolveWorkerRetryPolicy({ forkWorkerRetry: true, forkWorkerRetryMax: 0 }, null).enabled
    ).toBe(false)
    expect(resolveWorkerRetryPolicy({ forkWorkerRetryMax: 99 }, null).max).toBe(10)
  })
})

describe('workerRetryDelayMs', () => {
  it('doubles from the base and stops at the cap', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => workerRetryDelayMs(n, on))).toEqual([
      30_000, 60_000, 120_000, 240_000, 300_000, 300_000
    ])
  })
})

describe('decideWorkerRetry', () => {
  it('retries an exit, a loss and a transient provider error', () => {
    expect(decideWorkerRetry(input({}))).toMatchObject({ retry: true, attempt: 1, delayMs: 30_000 })
    expect(decideWorkerRetry(input({ stop: { reason: 'lost' } }))).toMatchObject({ retry: true })
    expect(
      decideWorkerRetry(
        input({ stop: { reason: 'errored', requestErrorKind: 'providerUnavailable' } })
      )
    ).toMatchObject({ retry: true, reason: 'provider error (providerUnavailable)' })
  })

  it('never retries a worker that reported, whatever its status', () => {
    expect(decideWorkerRetry(input({ workerReported: true }))).toEqual({
      retry: false,
      why: 'worker-reported'
    })
  })

  it('holds for every case that is not a transient failure', () => {
    const hold = (overrides: Partial<WorkerRetryInput>) => {
      const decision = decideWorkerRetry(input(overrides))
      return decision.retry ? 'retry' : decision.why
    }
    expect(hold({ policy: resolveWorkerRetryPolicy({}, null) })).toBe('off')
    expect(hold({ taskStatus: 'completed' })).toBe('task-settled')
    expect(hold({ stop: { reason: 'finished' } })).toBe('not-a-failure')
    expect(hold({ stop: { reason: 'needs-input' } })).toBe('not-a-failure')
    expect(hold({ stop: { reason: 'exited', cause: 'user-close' } })).toBe('deliberate')
    expect(hold({ stop: { reason: 'exited', neverStarted: true } })).toBe('never-started')
    expect(hold({ stop: { reason: 'errored' } })).toBe('not-transient')
    expect(hold({ stop: { reason: 'errored', requestErrorKind: 'usageLimitReached' } })).toBe(
      'not-transient'
    )
    expect(hold({ attemptsUsed: 2 })).toBe('exhausted')
  })
})
