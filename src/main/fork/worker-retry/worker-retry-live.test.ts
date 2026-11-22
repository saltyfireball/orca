import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import '../../runtime/orchestration/db/contract-constants'
import '../../runtime/orchestration/db/messages/mailbox-routing-page'
import '../../runtime/orchestration/db/dispatch-row-writer'
import '../../runtime/orchestration/db/attempt-outcome-projection'
import { createRootDispatch } from '../../runtime/orchestration/db/root-dispatch-test-fixture'
import { observeWorker } from '../../runtime/orchestration/workers/turn-stops/worker-presence-report'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { installForkWorkerRetry } from './worker-retry-live'
import { listRetries, readRunPolicy, writeRunPolicy } from './retry-store'

const started = vi.fn()
vi.mock('../../runtime/rpc/methods/orchestration/messaging/worker-follow-up', () => ({
  planWorkerFollowUp: () => ({ kind: 'start', latest: {}, resource: undefined }),
  startWorkerFollowUp: (args: unknown) => started(args)
}))

let settings: Record<string, unknown> = {}
const runtime = {
  requireStore: () => ({ getSettings: () => settings }),
  notifyMessageArrived: vi.fn()
} as unknown as OrcaRuntimeService

function rig() {
  const db = new OrchestrationDb(':memory:')
  const run = db.createRun({
    objective: 'retry',
    coordinatorHandle: 'term_coordinator',
    coordinatorPaneKey: 'tab-c::22222222-2222-4222-8222-222222222222' as never
  })
  const task = db.createTask({ spec: 'build the thing', runId: run.id })
  const dispatch = createRootDispatch(db, task.id, 'term_worker')
  installForkWorkerRetry(runtime, db)
  const deps = { getDb: () => db, isWaitingForMail: () => false, notify: vi.fn() }
  const kill = (fence = 'pid-1') =>
    observeWorker(
      db,
      { kind: 'local', dispatch },
      {
        presence: 'gone',
        fence,
        legacyStopKey: `exit:${fence}`,
        gone: { from: 'term_worker', reason: 'exited', lastOutput: undefined }
      },
      deps
    )
  return { db, run, task, dispatch, kill }
}

beforeEach(() => {
  vi.useFakeTimers()
  settings = {}
  started.mockReset()
  started.mockResolvedValue({ kind: 'started', receipt: { dispatchId: 'ctx_retry_1' } })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('worker retry on a killed worker', () => {
  it('does nothing while the policy is off: the coordinator gets the escalation', () => {
    const { db, run, kill } = rig()
    kill()
    expect(db.getUnreadRunMailbox(run.id, 100, ['escalation'])).toHaveLength(1)
    expect(listRetries(db)).toEqual([])
  })

  it('restarts the worker after the backoff, once, with the original spec', async () => {
    settings = { forkWorkerRetry: true }
    const { db, run, dispatch, kill } = rig()
    kill()
    // The coordinator is told, as news, not as an escalation to act on.
    expect(db.getUnreadRunMailbox(run.id, 100, ['escalation'])).toHaveLength(0)
    expect(db.getUnreadRunMailbox(run.id, 100, ['status'])[0]?.body).toContain(
      'automatic retry 1 of 2'
    )
    expect(listRetries(db)).toMatchObject([
      { dispatchId: dispatch.id, status: 'scheduled', attempt: 1 }
    ])
    kill() // the same stop seen again is the same retry
    expect(listRetries(db)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(29_000)
    expect(started).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(started).toHaveBeenCalledTimes(1)
    expect(started.mock.calls[0]?.[0].message.body).toContain('build the thing')
    expect(listRetries(db)).toMatchObject([{ status: 'started', retryDispatchId: 'ctx_retry_1' }])
  })

  it('takes the Run policy over the setting', () => {
    settings = { forkWorkerRetry: true }
    const { db, run, kill } = rig()
    writeRunPolicy(db, run.id, { enabled: false })
    expect(readRunPolicy(db, run.id)).toMatchObject({ enabled: false })
    kill()
    expect(listRetries(db)).toEqual([])
    expect(db.getUnreadRunMailbox(run.id, 100, ['escalation'])).toHaveLength(1)
  })

  it('never retries a worker that reported failed on purpose', () => {
    settings = { forkWorkerRetry: true }
    const { db, run, task, dispatch, kill } = rig()
    db.insertMessage({
      from: 'term_worker',
      to: `run:${run.id}`,
      subject: 'failed',
      type: 'worker_done',
      runId: run.id,
      payload: JSON.stringify({ taskId: task.id, dispatchId: dispatch.id, status: 'failed' })
    })
    kill()
    expect(listRetries(db)).toEqual([])
  })

  it('tells the coordinator when the restart itself fails', async () => {
    settings = { forkWorkerRetry: true }
    const { db, run, kill } = rig()
    started.mockRejectedValue(new Error('no workspace'))
    kill()
    await vi.advanceTimersByTimeAsync(31_000)
    expect(listRetries(db)).toMatchObject([{ status: 'failed', detail: 'no workspace' }])
    expect(db.getUnreadRunMailbox(run.id, 100, ['escalation'])[0]?.subject).toContain(
      'retry did not start'
    )
  })
})
