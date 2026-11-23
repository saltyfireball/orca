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
import type { WorkerExitKind } from '../../../shared/fork/worker-retry'
import { listRetries, readRunPolicy, writeRunPolicy } from './retry-store'

const pause = vi.hoisted(() => ({ engaged: false }))
vi.mock('../pause-all/pause-all-state', () => ({
  isForkPauseAllEngaged: () => pause.engaged
}))

import type * as FollowUpModule from '../../runtime/rpc/methods/orchestration/messaging/worker-follow-up'

const started = vi.fn()
// The plan is the real one; only the start, which needs a whole runtime, is stood in for.
vi.mock(
  '../../runtime/rpc/methods/orchestration/messaging/worker-follow-up',
  async (importActual) => ({
    ...(await importActual<typeof FollowUpModule>()),
    startWorkerFollowUp: (args: unknown) => started(args)
  })
)
vi.mock('../../runtime/rpc/orchestration/callers/orchestration-session-caller', () => ({
  readActingSessionRecord: async () => ({
    record: { location: { workspaceId: 'ws_chat' } }
  })
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
  // The worker's own record, which a follow-up continues.
  db.db
    .prepare(
      "INSERT INTO worker_dispatches (dispatch_id, state, updated_at) VALUES (?, 'ready', datetime('now'))"
    )
    .run(dispatch.id)
  installForkWorkerRetry(runtime, db)
  const deps = {
    getDb: () => db,
    isWaitingForMail: () => false,
    notify: vi.fn()
  }
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
  started.mockResolvedValue({
    kind: 'started',
    receipt: { dispatchId: 'ctx_retry_1' }
  })
})
afterEach(() => {
  pause.engaged = false
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

  it('keeps a due restart waiting while pause-all is engaged, then starts it (BAD-685)', async () => {
    settings = { forkWorkerRetry: true }
    const { db, kill } = rig()
    kill()
    pause.engaged = true
    await vi.advanceTimersByTimeAsync(120_000)
    expect(started).not.toHaveBeenCalled()
    expect(listRetries(db)).toMatchObject([{ status: 'scheduled' }])
    pause.engaged = false
    await vi.advanceTimersByTimeAsync(31_000)
    expect(started).toHaveBeenCalledTimes(1)
    expect(listRetries(db)).toMatchObject([{ status: 'started' }])
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
      payload: JSON.stringify({
        taskId: task.id,
        dispatchId: dispatch.id,
        status: 'failed'
      })
    })
    kill()
    // Left to the coordinator, and `orca retry show` says why.
    expect(listRetries(db)).toMatchObject([{ status: 'skipped', detail: 'the worker reported' }])
    expect(db.getUnreadRunMailbox(run.id, 100, ['escalation'])).toHaveLength(1)
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

const CHAT_SESSION = '0f8fad5b-d9cb-469f-a165-70867728950e'
const CHAT_TURN_WORKER = 'orca_session_id:worker-chat'

/** A chat worker: its Dispatch stays open when its provider fails, and mail starts it again. */
function chatRig(options: { chatCoordinator?: boolean; noCoordinator?: boolean } = {}) {
  const db = new OrchestrationDb(':memory:')
  const run = db.createRun({
    objective: 'retry',
    coordinatorHandle: options.chatCoordinator || options.noCoordinator ? null : 'term_coordinator',
    coordinatorPaneKey:
      options.chatCoordinator || options.noCoordinator
        ? null
        : ('tab-c::22222222-2222-4222-8222-222222222222' as never),
    ...(options.chatCoordinator ? { coordinatorOrcaSessionId: CHAT_SESSION as never } : {})
  })
  const task = db.createTask({ spec: 'build the thing', runId: run.id })
  const dispatch = createRootDispatch(db, task.id, CHAT_TURN_WORKER)
  db.db
    .prepare(
      "INSERT INTO worker_dispatches (dispatch_id, state, updated_at) VALUES (?, 'ready', datetime('now'))"
    )
    .run(dispatch.id)
  installForkWorkerRetry(runtime, db)
  const deps = {
    getDb: () => db,
    isWaitingForMail: () => false,
    notify: vi.fn()
  }
  const target = { kind: 'local' as const, dispatch }
  return {
    db,
    run,
    task,
    dispatch,
    providerError: (kind = 'providerUnavailable') =>
      observeWorker(
        db,
        target,
        {
          presence: 'at-rest',
          fence: 'turn-1',
          legacyStopKey: 'turn-1',
          rest: {
            from: CHAT_TURN_WORKER,
            reason: 'errored',
            lastOutput: undefined,
            requestError: { text: 'it failed', kind, facts: {} }
          }
        },
        deps
      ),
    gone: (exitKind: WorkerExitKind, fence = 'p1') =>
      observeWorker(
        db,
        target,
        {
          presence: 'gone',
          fence,
          legacyStopKey: `exit:${fence}`,
          gone: {
            from: CHAT_TURN_WORKER,
            reason: 'exited',
            exitKind,
            cause: 'whatever the report said',
            restartsOnMail: true,
            lastOutput: undefined
          }
        },
        deps
      ),
    working: () => observeWorker(db, target, { presence: 'working' }, deps)
  }
}

describe('worker retry for chat workers and chat-coordinated Runs (BAD-765)', () => {
  beforeEach(() => {
    settings = { forkWorkerRetry: true }
  })

  it('restarts a chat worker that stopped on a provider error, in a Run a chat coordinates', async () => {
    const { db, run, dispatch, providerError } = chatRig({
      chatCoordinator: true
    })
    providerError()
    expect(db.getDispatchContextById(dispatch.id)?.status).toBe('dispatched')
    await vi.advanceTimersByTimeAsync(31_000)
    expect(started).toHaveBeenCalledTimes(1)
    const args = started.mock.calls[0]?.[0]
    // Started as the coordinating chat, from a real follow-up plan of the settled Dispatch.
    expect(args.from).toBe(`orca_session_id:${CHAT_SESSION}`)
    expect(args.ctx.orchestrationCaller).toMatchObject({
      sessionId: CHAT_SESSION,
      workspaceId: 'ws_chat'
    })
    expect(args.plan.kind).toBe('start')
    expect(args.plan.latest.id).toBe(dispatch.id)
    expect(args.message.body).toContain('build the thing')
    expect(db.getDispatchContextById(dispatch.id)?.status).toBe('failed')
    expect(listRetries(db)).toMatchObject([{ status: 'started', retryDispatchId: 'ctx_retry_1' }])
    expect(db.getUnreadRunMailbox(run.id, 100, ['escalation'])).toHaveLength(0)
  })

  it('restarts a chat worker whose provider died, in a terminal-coordinated Run', async () => {
    const { db, gone } = chatRig()
    gone('provider_death')
    await vi.advanceTimersByTimeAsync(31_000)
    expect(started).toHaveBeenCalledTimes(1)
    expect(started.mock.calls[0]?.[0].from).toBe('term_coordinator')
    expect(listRetries(db)).toMatchObject([{ status: 'started' }])
  })

  it('restarts a worker an app update cut off, and leaves one the user quit alone', async () => {
    const update = chatRig({ chatCoordinator: true })
    update.gone('app_update')
    await vi.advanceTimersByTimeAsync(31_000)
    expect(started).toHaveBeenCalledTimes(1)
    expect(listRetries(update.db)).toMatchObject([{ status: 'started' }])
    started.mockClear()
    const quit = chatRig({ chatCoordinator: true })
    quit.gone('app_quit')
    await vi.advanceTimersByTimeAsync(31_000)
    expect(started).not.toHaveBeenCalled()
    expect(listRetries(quit.db)).toMatchObject([
      { status: 'skipped', detail: 'the worker was closed on purpose' }
    ])
  })

  it('never restarts a worker whose terminal the user closed, whatever the stop report says', async () => {
    const { db, run, gone } = chatRig()
    gone('operator_close')
    await vi.advanceTimersByTimeAsync(600_000)
    expect(started).not.toHaveBeenCalled()
    expect(listRetries(db)).toMatchObject([
      { status: 'skipped', detail: 'the worker was closed on purpose' }
    ])
    // The coordinator hears of it as before: a demand to act, not "Orca is retrying".
    expect(db.getUnreadRunMailbox(run.id, 100, ['escalation'])).toHaveLength(1)
    expect(db.getUnreadRunMailbox(run.id, 100, ['status'])).toHaveLength(0)
  })

  it('leaves a provider error a retry cannot fix with the coordinator, and says why', () => {
    const { db, run, providerError } = chatRig()
    providerError('usageLimitReached')
    expect(listRetries(db)).toMatchObject([
      { status: 'skipped', detail: 'the error is not one a retry fixes' }
    ])
    expect(db.getUnreadRunMailbox(run.id, 100, ['escalation'])).toHaveLength(1)
  })

  it('does not say Orca is retrying when no coordinator could start the restart', async () => {
    const { db, run, gone } = chatRig({ noCoordinator: true })
    gone('provider_death')
    expect(db.getUnreadRunMailbox(run.id, 100, ['status'])).toHaveLength(0)
    expect(listRetries(db)).toMatchObject([
      {
        status: 'skipped',
        detail: 'its Run has no coordinator to start it as'
      }
    ])
    await vi.advanceTimersByTimeAsync(600_000)
    expect(started).not.toHaveBeenCalled()
  })

  it('does not say Orca is retrying a worker that has no record to resume', () => {
    const { db, run, dispatch, gone } = chatRig()
    db.db.prepare('DELETE FROM worker_dispatches WHERE dispatch_id = ?').run(dispatch.id)
    gone('provider_death')
    expect(db.getUnreadRunMailbox(run.id, 100, ['status'])).toHaveLength(0)
    expect(listRetries(db)).toMatchObject([
      { status: 'skipped', detail: 'this worker cannot be resumed' }
    ])
  })

  it('cancels the restart when the worker is already working again', async () => {
    const { db, dispatch, gone, working } = chatRig()
    gone('provider_death')
    working()
    await vi.advanceTimersByTimeAsync(31_000)
    expect(started).not.toHaveBeenCalled()
    expect(db.getDispatchContextById(dispatch.id)?.status).toBe('dispatched')
    expect(listRetries(db)).toMatchObject([{ status: 'cancelled' }])
  })
})
