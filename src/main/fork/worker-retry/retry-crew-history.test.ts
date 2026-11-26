// BAD-681 "Retries appear in crew view, digest and task history with reason": a worker that ended
// goes through the real stop report and retry decision; its row in the coordinator's crew snapshot
// and `orca contract show` (the Task's history) both name the try, the reason and the state. Only
// the agent placement of the restart, which needs a whole runtime, is stood in for.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixture } from '../../runtime/orchestration/crew/crew-read-model.test-fixture'
import { buildCrewSnapshot } from '../../runtime/orchestration/crew/crew-party-snapshot'
import { observeWorker } from '../../runtime/orchestration/workers/turn-stops/worker-presence-report'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { DispatchContextRow } from '../../runtime/orchestration/db/orchestration-records'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { formatForkContract } from '../../../cli/fork/completion-contract-handlers'
import { showContractOf } from '../completion-contract/contract-show'
import { installForkWorkerRetry } from './worker-retry-live'
import { recordRetry, settleRetry } from './retry-store'
import { readForkDigestRetries } from './retry-digest'
import { formatForkDigestText } from '../../../shared/fork/digest-format'
import { totalForkDigest } from '../../../shared/fork/digest'

vi.mock('../pause-all/pause-all-state', () => ({ isForkPauseAllEngaged: () => false }))
vi.mock(
  '../../runtime/rpc/methods/orchestration/worker/start/placement/worker-start-agent-placement',
  async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    placeWorkerAgent: async () => {
      throw new Error('the build host is not reachable')
    }
  })
)

function runtimeFor(db: OrchestrationDb, pane: string, settings: object): OrcaRuntimeService {
  return {
    getOrchestrationDb: () => db,
    // Upstream's worker-start checks the agent is installed before any launch.
    detectProjectLaunchContext: async () => ({ agents: ['claude', 'codex'] }),
    getNestedWorkerMaxDepth: () => 4,
    showTerminal: async (handle: string) => ({ handle, worktreeId: 'wt_1' }),
    validateOrchestrationAgentLauncher: () => undefined,
    getTerminalProcessIncarnation: () => 'process:term_coord',
    getRuntimeId: () => 'runtime_test',
    showManagedTerminalWorkspace: async () => ({ id: 'wt_1', path: '/work/app', repoId: 'repo_1' }),
    getTerminalPaneKey: () => pane,
    requireStore: () => ({ getSettings: () => ({ forkWorkerRetry: true, ...settings }) }),
    notifyMessageArrived: vi.fn()
  } as unknown as OrcaRuntimeService
}

function rig() {
  const f = fixture()
  const dispatch = f.assign('term_worker', 'term_coord', 'Port the importer')
  f.db.db
    .prepare(
      "INSERT INTO worker_dispatches (dispatch_id, state, worktree_id, start_options, updated_at) VALUES (?, 'ready', 'wt_1', '{\"agent\":\"claude\"}', datetime('now'))"
    )
    .run(dispatch.id)
  /** The coordinator's crew row of a Dispatch's worker, found by its Task's title. */
  const rowOf = (dispatchId: string) => {
    const task = f.db.getTask(f.db.getDispatchContextById(dispatchId)!.task_id)!
    const rows = buildCrewSnapshot('term_coord', f.deps).sections.managing
    return rows.find((row) => row.task?.title === task.task_title)
  }
  return { ...f, dispatch, rowOf }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/** The worker's process exited: the stop report a killed terminal worker makes. */
function stop(db: OrchestrationDb, dispatch: DispatchContextRow) {
  observeWorker(
    db,
    { kind: 'local', dispatch },
    {
      presence: 'gone',
      fence: 'pid-1',
      legacyStopKey: 'exit:pid-1',
      gone: {
        from: 'term_worker',
        reason: 'exited',
        lastOutput: undefined,
        exitKind: 'process_exited'
      }
    },
    { getDb: () => db, isWaitingForMail: () => false, notify: vi.fn() }
  )
}

describe('a retry in the crew view and the Task history', () => {
  it('shows the waiting retry with its time, then the restart on both workers', async () => {
    const { db, dispatch, rowOf, handles } = rig()
    installForkWorkerRetry(runtimeFor(db, handles.get('term_coord')!, {}), db)
    stop(db, dispatch)

    const waiting = rowOf(dispatch.id)?.forkRetry
    expect(waiting).toMatchObject({ attempt: 1, state: 'waiting', side: 'ended' })
    expect(Date.parse(waiting!.dueAt!) - Date.now()).toBe(30_000)
    expect(waiting!.reason).toContain('exited')
    const shownWaiting = showContractOf(db, dispatch.task_id)
    expect(shownWaiting.retries).toMatchObject([{ attempt: 1, status: 'scheduled' }])
    expect(formatForkContract(shownWaiting)).toMatch(/retry 1 scheduled, due .*: .*exited/u)

    await vi.advanceTimersByTimeAsync(31_000)
    const shown = showContractOf(db, dispatch.task_id)
    expect(shown.retries).toMatchObject([{ attempt: 1, status: 'started' }])
    const restartId = shown.retries![0]!.retryDispatchId!
    expect(rowOf(dispatch.id)?.forkRetry).toMatchObject({ state: 'restarted', side: 'ended' })
    expect(formatForkContract(shown)).toContain(`retry 1 started: ${waiting!.reason}`)

    const restart = db.getDispatchContextById(restartId)!
    expect(rowOf(restartId)?.forkRetry).toEqual({
      attempt: 1,
      reason: waiting!.reason,
      state: 'restarted',
      side: 'restart'
    })
    expect(formatForkContract(showContractOf(db, restart.task_id))).toContain(
      `was started by automatic retry 1 of Task ${dispatch.task_id}: ${waiting!.reason}`
    )
    // The restart was started in the workspace the ended worker had.
    const startOptions = JSON.parse(db.getWorkerDispatch(restartId)!.start_options ?? '{}')
    expect(startOptions).toMatchObject({ resolvedWorktreeId: 'wt_1' })

    // The digest's "Worker retries" block names the same retry with its reason.
    const since = Date.now() - 3_600_000
    const section = {
      tasks: [],
      pullRequests: [],
      waiting: [],
      retries: readForkDigestRetries(db, since),
      cost: null,
      notes: []
    }
    const hosts = [{ hostKey: 'local', name: 'this computer', status: 'ok' as const, section }]
    const digest = formatForkDigestText({
      since,
      until: Date.now(),
      hosts,
      serversDown: [],
      totals: totalForkDigest(hosts)
    })
    expect(digest).toContain('Worker retries')
    expect(digest).toContain(`Port the importer: retry 1 started (${waiting!.reason})`)
  })

  it('gives up at the default limit of 2 and says why', () => {
    const { db, dispatch, assign, rowOf, handles } = rig()
    // Two earlier workers of the chain were already restarted, the second one as this worker.
    const first = assign('term_helper', 'term_coord', 'Port the importer, first try')
    const second = assign('term_grandchild', 'term_coord', 'Port the importer, second try')
    for (const [ended, next, attempt] of [
      [first, second, 1],
      [second, dispatch, 2]
    ] as const) {
      recordRetry(db, {
        taskId: ended.task_id,
        runId: ended.run_id,
        dispatchId: ended.id,
        attempt,
        reason: 'the worker process exited',
        dueAtMs: Date.now()
      })
      settleRetry(db, ended.id, 'started', { retryDispatchId: next.id })
    }
    installForkWorkerRetry(runtimeFor(db, handles.get('term_coord')!, {}), db)
    stop(db, dispatch)

    expect(rowOf(dispatch.id)?.forkRetry).toMatchObject({
      attempt: 2,
      state: 'gave-up',
      side: 'ended',
      detail: 'the limit was reached'
    })
    expect(formatForkContract(showContractOf(db, dispatch.task_id))).toContain(
      'retry 2 skipped (the limit was reached)'
    )
  })
})
