// BAD-799: Pause all over the terminal-worker restart resume, through the real runtime's own wiring
// (OrcaRuntimeService builds the holds, the resume and its offers), the real recovery plan that finds
// a lost worker, the real startup hook and the real `fork.pauseAll.set` method a paired client calls.
// Only the terminal itself is stood in for: the reopened agent, its readiness and the prompt send.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestStores, createStore, testState } from '../../persistence/persistence-test-harness'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { isWorkerRestartOffered } from '../../runtime/orchestration/db/worker-dispatch/worker-restart-resume'
import { resetForkPauseAllCacheForTests, writeForkPauseAll } from './pause-all-state'
import { PAUSE_ALL_RESTART_HELD_REASON } from './pause-all-restart-holds'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../runtime/terminal/wait/launched-agent-composer-readiness', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  waitForWorkerAgentReady: async () => ({ satisfied: true })
}))

let dbFile = ''

beforeEach(() => {
  testState.dir = mkdtempSync(join(tmpdir(), 'pause-all-runtime-'))
  dbFile = join(testState.dir, 'orchestration.db')
  resetForkPauseAllCacheForTests()
})

afterEach(async () => {
  await closeTestStores()
  resetForkPauseAllCacheForTests()
  rmSync(testState.dir, { recursive: true, force: true })
})

/** A worker cut mid-turn by a restart, its terminal gone. */
function lostWorker(db: OrchestrationDb): string {
  const run = db.createRun({
    objective: 'maintenance',
    coordinatorHandle: 'term_coordinator',
    coordinatorPaneKey: 'tab_c:leaf_c'
  })
  const task = db.createTask({ spec: 'keep working', runId: run.id })
  const { dispatch } = db.createStartingWorkerDispatch({
    creator: { kind: 'system' },
    maxDepth: Number.MAX_SAFE_INTEGER,
    taskId: task.id,
    startOptions: { topology: 'current', agent: 'codex' }
  })
  db.prepareStartingWorkerAuthority({
    dispatchId: dispatch.id,
    handle: 'term_lost',
    paneKey: 'tab_lost:33333333-3333-4333-8333-333333333333',
    processIncarnation: 'pty-lost:11111111-1111-4111-8111-111111111111',
    worktreeId: 'repo::/tmp/repo',
    setupState: 'not_applicable',
    effects: [],
    terminalOwnership: 'created'
  })
  db.markWorkerDispatchReady(dispatch.id)
  db.db
    .prepare('UPDATE worker_terminal_resources SET resume_session = ? WHERE owner_dispatch_id = ?')
    .run(
      JSON.stringify({
        agent: 'codex',
        providerSession: { key: 'session_id', id: 'thread-1' },
        connectionId: null
      }),
      dispatch.id
    )
  db.db
    .prepare(
      "INSERT INTO worker_presence (dispatch_id, presence, generation) VALUES (?, 'working', 1)"
    )
    .run(dispatch.id)
  return dispatch.id
}

type RuntimePorts = {
  legacyWorkerRecoveryPersistence: { prepare: () => { candidates: { dispatchId: string }[] } }
  holdLostWorkerForRestartResume: (candidate: { dispatchId: string }) => boolean
  terminalWorkerRestartResume: { isHeld: (dispatchId: string) => boolean }
}

/** One app start: a new runtime over the same data folder and orchestration database. */
async function appStart() {
  const store = createStore()
  store.updateSettings({ nativeChatResumeWorkOnRestart: true })
  const { OrcaRuntimeService } = await import('../../runtime/orca-runtime')
  const runtime = new OrcaRuntimeService(store as never)
  const db = new OrchestrationDb(dbFile)
  runtime.setOrchestrationDb(db)
  const reopen = vi
    .spyOn(runtime, 'resumeAgentSessionInWorkspace')
    .mockResolvedValue({ ok: true, handle: 'term_resumed' } as never)
  vi.spyOn(runtime, 'getOrchestrationDispatchAuthority').mockReturnValue(null)
  vi.spyOn(runtime, 'getTerminalPaneKey').mockReturnValue(
    'tab_new:44444444-4444-4444-8444-444444444444'
  )
  vi.spyOn(runtime, 'getTerminalProcessIncarnation').mockReturnValue(
    'pty-new:22222222-2222-4222-8222-222222222222'
  )
  const sendPrompt = vi
    .spyOn(runtime, 'sendTerminalAgentPrompt')
    .mockResolvedValue({ prompt: { observation: 'unsupported', stages: [] } } as never)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the recovery pass's own plan, hold port and resume, protected on the runtime.
  const ports = runtime as unknown as RuntimePorts
  /** The start's recovery pass: every lost worker the real plan names goes to the real hold port. */
  const recover = (): string[] =>
    ports.legacyWorkerRecoveryPersistence.prepare().candidates.flatMap((candidate) => {
      // The pass skips a worker this start is already resuming.
      if (ports.terminalWorkerRestartResume.isHeld(candidate.dispatchId)) {
        return []
      }
      expect(ports.holdLostWorkerForRestartResume(candidate)).toBe(true)
      return [candidate.dispatchId]
    })
  /** The real startup hook: restored terminals are placed. */
  const settle = (): void => void runtime.reportWorkerStopsAcrossRestartOnce()
  return { runtime, db, reopen, sendPrompt, recover, settle }
}

/** `orca resume-all` from another machine reaching this host: the relayed `fork.pauseAll.set`. */
async function resumeAllFromPairedClient(runtime: unknown): Promise<void> {
  const { FORK_PAUSE_ALL_METHODS } = await import('../../runtime/rpc/methods/fork/fork-pause-all')
  const set = FORK_PAUSE_ALL_METHODS.find((method) => method.name === 'fork.pauseAll.set')!
  await (set.handler as (params: unknown, ctx: unknown) => Promise<unknown>)(
    { engaged: false, relayed: true },
    { runtime }
  )
}

describe('Pause all over the real runtime restart resume', () => {
  it('holds the lost worker as an offer while paused, and a relayed resume-all resumes it once', async () => {
    const first = await appStart()
    const dispatchId = lostWorker(first.db)
    writeForkPauseAll(true, { by: 'cli' })

    expect(first.recover()).toEqual([dispatchId])
    first.settle()
    expect(first.runtime.terminalWorkerRestartOffers.list()).toMatchObject([
      { sessionId: dispatchId, surface: 'terminal', heldReason: PAUSE_ALL_RESTART_HELD_REASON }
    ])
    expect(first.reopen).not.toHaveBeenCalled()

    await resumeAllFromPairedClient(first.runtime)
    await vi.waitFor(() => expect(first.sendPrompt).toHaveBeenCalledTimes(1))
    expect(first.reopen).toHaveBeenCalledTimes(1)
    expect(first.db.getDispatchContextById(dispatchId)?.assignee_handle).toBe('term_resumed')
    expect(first.runtime.terminalWorkerRestartOffers.list()).toEqual([])
    first.db.close()
  })

  it('resumes a worker held at an earlier start once this start settles, when the switch was released while the app was down', async () => {
    const first = await appStart()
    const dispatchId = lostWorker(first.db)
    writeForkPauseAll(true, { by: 'cli' })
    first.recover()
    first.settle()
    await vi.waitFor(() => expect(first.runtime.terminalWorkerRestartOffers.list()).toHaveLength(1))
    // The note reaches disk before the app quits.
    await new Promise((resolve) => setTimeout(resolve, 50))
    first.db.close()
    await closeTestStores()

    // Released with this app down (another machine's resume-all could not reach it).
    writeForkPauseAll(false, { by: 'cli' })
    resetForkPauseAllCacheForTests()
    const next = await appStart()
    // The offered worker is judged lost again by the next start's real plan, and stays offered.
    expect(next.recover()).toEqual([dispatchId])
    expect(isWorkerRestartOffered(next.db, dispatchId)).toBe(true)
    expect(next.reopen).not.toHaveBeenCalled()
    next.settle()
    await vi.waitFor(() => expect(next.sendPrompt).toHaveBeenCalledTimes(1))
    expect(next.reopen).toHaveBeenCalledTimes(1)
    next.db.close()
  })
})
