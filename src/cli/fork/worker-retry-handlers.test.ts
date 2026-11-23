import { describe, expect, it } from 'vitest'
import { formatForkWorkerRetry } from './worker-retry-handlers'

describe('formatForkWorkerRetry', () => {
  it('lists a retry that was not started with why (BAD-765)', () => {
    const text = formatForkWorkerRetry({
      policy: {
        enabled: true,
        max: 2,
        backoffMs: 30_000,
        maxBackoffMs: 300_000,
        run: null,
        own: null
      },
      retries: [
        {
          taskId: 'task_1',
          runId: 'run_1',
          dispatchId: 'ctx_1',
          retryDispatchId: null,
          attempt: 0,
          reason: 'worker lost (it was closed in Orca)',
          at: '2026-01-01 00:00:00',
          dueAt: '2026-01-01T00:00:00.000Z',
          status: 'skipped',
          detail: 'the worker was closed on purpose'
        }
      ]
    })
    expect(text).toContain(
      'task_1 not retried: worker lost (it was closed in Orca) (the worker was closed on purpose)'
    )
  })
})
