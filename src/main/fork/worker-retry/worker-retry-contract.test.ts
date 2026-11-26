// BAD-763: a retried worker is a new Task, and it keeps the contract and review request of the Task
// it continues. The restart goes through the real startWorkerFollowUp -> startWorker ->
// startLocalWorker; only the placement of the agent, which needs a whole runtime, is stood in for.
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
import { listRetries } from './retry-store'
import { readContract, saveContract } from '../completion-contract/contract-store'
import { readReviewGate, saveReviewGate } from '../reviewer-gate/reviewer-store'

vi.mock('../pause-all/pause-all-state', () => ({ isForkPauseAllEngaged: () => false }))
const placed = vi.hoisted(() => ({ calls: [] as unknown[] }))
vi.mock(
  '../../runtime/rpc/methods/orchestration/worker/start/placement/worker-start-agent-placement',
  async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    placeWorkerAgent: async (args: unknown) => {
      placed.calls.push(args)
      throw new Error('placement stands in for a whole runtime')
    }
  })
)

let activeDb: OrchestrationDb
const runtime = {
  getOrchestrationDb: () => activeDb,
  // Upstream's worker-start checks the agent is installed before any launch.
  detectProjectLaunchContext: async () => ({ agents: ['claude', 'codex'] }),
  getNestedWorkerMaxDepth: () => 4,
  showTerminal: async (handle: string) => ({ handle, worktreeId: 'wt_1' }),
  validateOrchestrationAgentLauncher: () => undefined,
  getTerminalProcessIncarnation: () => 'pid-coordinator',
  getRuntimeId: () => 'runtime_test',
  showManagedTerminalWorkspace: async () => ({ id: 'wt_1', path: '/work/app', repoId: 'repo_1' }),
  getTerminalPaneKey: () => 'tab-c::22222222-2222-4222-8222-222222222222',
  requireStore: () => ({ getSettings: () => ({ forkWorkerRetry: true }) }),
  notifyMessageArrived: vi.fn()
} as unknown as OrcaRuntimeService

beforeEach(() => {
  vi.useFakeTimers()
  placed.calls = []
})
afterEach(() => {
  vi.useRealTimers()
})

describe('a retry through the real follow-up start', () => {
  it('gives the restarted worker a Task with the same checks and review request', async () => {
    const db = new OrchestrationDb(':memory:')
    const run = db.createRun({
      objective: 'retry',
      coordinatorHandle: 'term_coordinator',
      coordinatorPaneKey: 'tab-c::22222222-2222-4222-8222-222222222222' as never
    })
    const task = db.createTask({ spec: 'build the thing', runId: run.id })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')
    db.db
      .prepare(
        "INSERT INTO worker_dispatches (dispatch_id, state, worktree_id, start_options, updated_at) VALUES (?, 'ready', 'wt_1', '{\"agent\":\"claude\"}', datetime('now'))"
      )
      .run(dispatch.id)
    saveContract(db, task.id, { checks: ['pnpm test'], requirePrChecks: false, maxRounds: 2 })
    saveReviewGate(db, task.id, { focus: 'correctness', agent: null, maxRounds: null })
    activeDb = db
    installForkWorkerRetry(runtime, db)

    observeWorker(
      db,
      { kind: 'local', dispatch },
      {
        presence: 'gone',
        fence: 'pid-1',
        legacyStopKey: 'exit:pid-1',
        gone: { from: 'term_worker', reason: 'exited', lastOutput: undefined }
      },
      { getDb: () => db, isWaitingForMail: () => false, notify: vi.fn() }
    )
    expect(listRetries(db)).toMatchObject([{ status: 'scheduled' }])
    await vi.advanceTimersByTimeAsync(31_000)

    const tasks = db.db
      .prepare('SELECT id FROM tasks WHERE run_id = ? AND id != ?')
      .all(run.id, task.id) as { id: string }[]
    expect(tasks, JSON.stringify(listRetries(db))).toHaveLength(1)
    const retried = tasks[0]!.id
    // The start ran as far as placing the agent, so the real start path carried the contract.
    expect(placed.calls).toHaveLength(1)
    expect(readContract(db, retried)).toMatchObject({
      contract: { checks: ['pnpm test'], maxRounds: 2 },
      failedRounds: 0
    })
    expect(readReviewGate(db, retried)?.gate).toMatchObject({ focus: 'correctness' })
  })
})
