// BAD-799: a terminal worker-start while Pause all is engaged is refused with the pause reason, before
// any Task or Dispatch is written. Runs the real startWorker -> startLocalWorker against a real
// orchestration database and the real switch file in a temp data folder; only the agent's placement,
// which needs a whole runtime, is stood in for (it records that the start got that far).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const paths = vi.hoisted(() => ({ userData: '' }))
vi.mock('../../../shared/app-lifecycle/app-environment', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  getAppEnvironment: () => ({ getPath: () => paths.userData }),
  hasAppEnvironment: () => true
}))
const placed = vi.hoisted(
  (): { modes: string[]; real: boolean; worktrees: number; terminals: number } => ({
    modes: [],
    real: false,
    worktrees: 0,
    terminals: 0
  })
)
vi.mock(
  '../../runtime/rpc/methods/orchestration/worker/start/placement/worker-start-agent-placement',
  async (importActual) => {
    const actual = await importActual<Record<string, unknown>>()
    return {
      ...actual,
      placeWorkerAgent: async (args: { mode: { mode: string } }) => {
        placed.modes.push(args.mode.mode)
        if (placed.real) {
          return (actual.placeWorkerAgent as (a: unknown) => Promise<unknown>)(args)
        }
        throw new Error('placement stands in for a whole runtime')
      }
    }
  }
)
// The real placement runs down to the workspace and terminal it would create, which are counted.
vi.mock(
  '../../runtime/rpc/methods/orchestration/worker/start/placement/worker-worktree-creation',
  async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    createWorkerWorktree: async () => {
      placed.worktrees += 1
      throw new Error('a workspace was created')
    }
  })
)
vi.mock(
  '../../runtime/rpc/methods/orchestration/worker/start/placement/worker-placement-topology',
  async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    createExistingWorktreeWorkerTerminal: async () => {
      placed.terminals += 1
      throw new Error('a terminal agent was launched')
    }
  })
)

import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import '../../runtime/orchestration/db/contract-constants'
import '../../runtime/orchestration/db/messages/mailbox-routing-page'
import '../../runtime/orchestration/db/dispatch-row-writer'
import '../../runtime/orchestration/db/attempt-outcome-projection'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { startWorker } from '../../runtime/rpc/methods/orchestration/worker/worker-start-method'
import { WorkerStartParams } from '../../../shared/rpc-contract/orchestration/orchestration-worker-start-params'
import {
  PAUSE_ALL_STATE_FILE_NAME,
  resetForkPauseAllCacheForTests,
  writeForkPauseAll
} from './pause-all-state'
import { PAUSE_ALL_WORKER_START_CODE } from './pause-all-terminal-worker-start'

let db: OrchestrationDb
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the start reads only these runtime members.
const runtime = {
  getOrchestrationDb: () => db,
  // Upstream's worker-start checks the agent is installed before any launch.
  detectProjectLaunchContext: async () => ({ agents: ['claude', 'codex'] }),
  getNestedWorkerMaxDepth: () => 4,
  showTerminal: async (handle: string) => ({ handle, worktreeId: 'wt_1' }),
  validateOrchestrationAgentLauncher: () => undefined,
  getTerminalProcessIncarnation: () => 'pid-coordinator',
  getRuntimeId: () => 'runtime_test',
  showManagedTerminalWorkspace: async () => ({ id: 'wt_1', path: '/work/app', repoId: 'repo_1' }),
  getTerminalPaneKey: () => 'tab-c::22222222-2222-4222-8222-222222222222',
  showRepo: async () => ({ id: 'repo_1', path: '/work/app', kind: 'git' }),
  requireStore: () => ({ getSettings: () => ({}) }),
  notifyMessageArrived: vi.fn(),
  cancelMessageWaiters: vi.fn()
} as unknown as OrcaRuntimeService

beforeEach(() => {
  paths.userData = mkdtempSync(join(tmpdir(), 'pause-all-start-'))
  resetForkPauseAllCacheForTests()
  placed.modes = []
  placed.real = false
  placed.worktrees = 0
  placed.terminals = 0
  db = new OrchestrationDb(':memory:')
})
afterEach(() => {
  db.close()
  rmSync(paths.userData, { recursive: true, force: true })
})

const start = (worktree?: string) =>
  startWorker(
    WorkerStartParams.parse({
      spec: 'Build the parser.',
      agent: 'claude',
      from: 'term_coordinator',
      ...(worktree ? { worktree, repo: 'id:repo_1' } : {})
    }),
    { runtime }
  )

/** The switch engages after the early check passed, as the Dispatch is written. */
function engageAsTheDispatchIsWritten(): void {
  const write = db.createStartingWorkerDispatch.bind(db)
  vi.spyOn(db, 'createStartingWorkerDispatch').mockImplementation((...args) => {
    writeForkPauseAll(true, { by: 'cli' })
    return write(...args)
  })
}

const dispatchRow = () =>
  db.db.prepare('SELECT status, last_failure FROM dispatch_contexts').get() as
    | { status: string; last_failure: string | null }
    | undefined
const taskCount = (): unknown => db.db.prepare('SELECT COUNT(*) AS n FROM tasks').get()?.n

describe('a terminal worker-start under Pause all', () => {
  it('is refused with the pause reason while engaged, writing nothing', async () => {
    writeForkPauseAll(true, { by: 'cli' })
    await expect(start()).rejects.toMatchObject({
      code: PAUSE_ALL_WORKER_START_CODE,
      message: expect.stringContaining('Paused by pause-all')
    })
    await expect(start()).rejects.toThrow('orca resume-all')
    expect(placed.modes).toEqual([])
    expect(taskCount()).toBe(0)
  })

  it('is refused while the switch cannot be read', async () => {
    writeFileSync(join(paths.userData, PAUSE_ALL_STATE_FILE_NAME), 'not json')
    await expect(start()).rejects.toThrow('counts as engaged')
    expect(placed.modes).toEqual([])
  })

  it('starts as before with the switch off', async () => {
    // The start ran as far as placing a terminal agent; the stand-in's failure is its receipt.
    await expect(start()).resolves.toMatchObject({
      mode: { mode: 'terminal' },
      lastError: 'placement stands in for a whole runtime'
    })
    expect(placed.modes).toEqual(['terminal'])
    expect(taskCount()).toBe(1)
  })

  it('refuses at the terminal agent launch when paused after the early check, failing its Dispatch with the reason', async () => {
    placed.real = true
    engageAsTheDispatchIsWritten()
    const receipt = await start()
    expect(receipt).toMatchObject({ lastError: expect.stringContaining('Paused by pause-all') })
    expect(placed.terminals).toBe(0)
    expect(dispatchRow()).toMatchObject({
      status: 'failed',
      last_failure: expect.stringContaining('orca resume-all')
    })
  })

  it('refuses a new worktree start before its workspace exists when paused after the early check', async () => {
    placed.real = true
    engageAsTheDispatchIsWritten()
    const receipt = await start('new-top-level')
    expect(placed.modes).toEqual(['terminal'])
    expect(receipt).toMatchObject({ lastError: expect.stringContaining('Paused by pause-all') })
    expect(placed.worktrees).toBe(0)
    expect(dispatchRow()).toMatchObject({
      status: 'failed',
      last_failure: expect.stringContaining('orca resume-all')
    })
  })
})
