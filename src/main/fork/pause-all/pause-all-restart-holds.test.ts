// BAD-799: Pause all over the terminal-worker restart resume. Runs the real restart resume, its real
// offers and a real orchestration database, with the real switch and held-worker files in a temp data
// folder. Only the terminal side is stood in for: the reopened terminal, its authority and the send of
// the continue prompt, which a test cannot spawn.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const paths = vi.hoisted(() => ({ userData: '' }))
vi.mock('../../../shared/app-lifecycle/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => paths.userData }),
  hasAppEnvironment: () => true
}))

import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { isWorkerRestartOffered } from '../../runtime/orchestration/db/worker-dispatch/worker-restart-resume'
import {
  TerminalWorkerRestartResume,
  type TerminalWorkerRestartResumeDeps
} from '../../runtime/orchestration/workers/restart-resume/terminal-worker-restart-resume'
import { TerminalWorkerRestartOffers } from '../../runtime/orchestration/workers/restart-resume/terminal-worker-restart-offers'
import {
  PAUSE_ALL_STATE_FILE_NAME,
  resetForkPauseAllCacheForTests,
  writeForkPauseAll
} from './pause-all-state'
import {
  ForkPauseAllRestartHolds,
  PAUSE_ALL_RESTART_HELD_REASON,
  PAUSE_ALL_RESTART_HOLDS_FILE_NAME
} from './pause-all-restart-holds'

let db: OrchestrationDb

/** The held workers are on disk, as a start that ran a while before quitting leaves them. */
const heldNoteSaved = () =>
  vi.waitFor(() =>
    expect(existsSync(join(paths.userData, PAUSE_ALL_RESTART_HOLDS_FILE_NAME))).toBe(true)
  )

beforeEach(() => {
  paths.userData = mkdtempSync(join(tmpdir(), 'pause-all-restart-'))
  resetForkPauseAllCacheForTests()
  db = new OrchestrationDb(':memory:')
})
afterEach(() => {
  db.close()
  rmSync(paths.userData, { recursive: true, force: true })
})

/** A worker cut mid-turn by a restart, its terminal gone. */
function lostWorker(index = 0): string {
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
    handle: `term_lost${index}`,
    paneKey: `tab_lost:leaf_lost${index}`,
    processIncarnation: `pty-lost${index}:11111111-1111-4111-8111-111111111111`,
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

type Reopen = TerminalWorkerRestartResumeDeps['reopen']

/** One app start: the runtime's own wiring of the resume, its offers and the pause-all holds. */
function appStart(
  resumeWorkOnRestart = true,
  reopen = vi.fn<Reopen>(async () => ({ handle: 'term_resumed' }))
) {
  const sendPrompt = vi.fn(async () => true)
  const failLost = vi.fn()
  let resume: TerminalWorkerRestartResume | undefined
  const holds = new ForkPauseAllRestartHolds({
    getDb: () => db,
    resumeWorkOnRestart: () => resumeWorkOnRestart,
    resumeOffered: (dispatchId, fail) => resume!.resumeOffered(dispatchId, fail),
    offersChanged: () => {}
  })
  resume = new TerminalWorkerRestartResume({
    getDb: () => db,
    resumeWorkOnRestart: (dispatchId) => holds.resumes(dispatchId),
    startupSettled: () => holds.startupSettled(),
    reopen,
    closeTerminal: async () => undefined,
    reportResting: async () => undefined,
    reportContinueWithheld: async () => undefined,
    decideHeldRest: () => {},
    offersChanged: () => {},
    terminalAuthority: () => ({
      paneKey: 'tab_new:leaf_new',
      processIncarnation: 'pty-new:22222222-2222-4222-8222-222222222222'
    }),
    handleForPane: () => 'term_resumed',
    paneConversation: () => 'unknown',
    paneSessions: () => [],
    waitForAgentReady: async () => true,
    sendPrompt,
    setTimer: () => ({ cancel: () => {} })
  })
  const offers = new TerminalWorkerRestartOffers({
    getDb: () => db,
    resume,
    failLost,
    heldReasons: () => holds.heldReasons()
  })
  /** The start's recovery pass finding the lost workers, before its restored terminals are placed. */
  const judgeLost = (...dispatchIds: string[]): void => {
    for (const dispatchId of dispatchIds) {
      expect(resume!.holdForReopen(dispatchId, () => failLost(dispatchId))).toBe(true)
    }
  }
  const settle = (): void => resume!.settleStartup()
  /** The pass, then startup settling. */
  const recover = (dispatchId: string): void => {
    judgeLost(dispatchId)
    settle()
  }
  return { holds, offers, recover, judgeLost, settle, sendPrompt, reopen, failLost }
}

describe('a restart while Pause all is engaged', () => {
  it('offers the worker with the reason, sends nothing, and resume-all resumes it once', async () => {
    const dispatchId = lostWorker()
    writeForkPauseAll(true, { by: 'cli' })
    const start = appStart()
    start.recover(dispatchId)

    expect(start.reopen).not.toHaveBeenCalled()
    expect(start.sendPrompt).not.toHaveBeenCalled()
    expect(start.offers.list()).toMatchObject([
      { sessionId: dispatchId, surface: 'terminal', heldReason: PAUSE_ALL_RESTART_HELD_REASON }
    ])

    writeForkPauseAll(false, { by: 'cli' })
    await vi.waitFor(() => expect(start.sendPrompt).toHaveBeenCalledTimes(1))
    expect(db.getDispatchContextById(dispatchId)?.assignee_handle).toBe('term_resumed')
    expect(start.offers.list()).toEqual([])
    // A second release, by the listener or by hand, resumes nothing again.
    expect(await start.holds.release()).toEqual([])
    writeForkPauseAll(true, { by: 'cli' })
    writeForkPauseAll(false, { by: 'cli' })
    await start.holds.release()
    expect(start.reopen).toHaveBeenCalledTimes(1)
    expect(start.sendPrompt).toHaveBeenCalledTimes(1)
    expect(start.failLost).not.toHaveBeenCalled()
  })

  it('counts an unreadable switch as engaged', async () => {
    const dispatchId = lostWorker()
    writeFileSync(join(paths.userData, PAUSE_ALL_STATE_FILE_NAME), '{ broken')
    const start = appStart()
    start.recover(dispatchId)
    expect(start.reopen).not.toHaveBeenCalled()
    expect(start.sendPrompt).not.toHaveBeenCalled()
    expect(start.offers.list()).toMatchObject([{ heldReason: PAUSE_ALL_RESTART_HELD_REASON }])
    // resume-all clears the damaged switch and releases the held worker.
    writeForkPauseAll(false, { by: 'cli' })
    await vi.waitFor(() => expect(start.sendPrompt).toHaveBeenCalledTimes(1))
  })

  it('with the switch off, resumes and continues the worker at once, as before', async () => {
    const dispatchId = lostWorker()
    const start = appStart()
    start.recover(dispatchId)
    await vi.waitFor(() => expect(start.sendPrompt).toHaveBeenCalledTimes(1))
    expect(start.offers.list()).toEqual([])
    expect(start.holds.heldReasons().size).toBe(0)
  })

  it('keeps it held across another restart while paused, then resumes it once', async () => {
    const dispatchId = lostWorker()
    writeForkPauseAll(true, { by: 'cli' })
    appStart().recover(dispatchId)
    await heldNoteSaved()
    // The next start, still paused: a new runtime over the same database and data folder.
    resetForkPauseAllCacheForTests()
    const second = appStart()
    second.recover(dispatchId)
    expect(second.reopen).not.toHaveBeenCalled()
    await vi.waitFor(() =>
      expect(second.offers.list()).toMatchObject([{ heldReason: PAUSE_ALL_RESTART_HELD_REASON }])
    )
    writeForkPauseAll(false, { by: 'cli' })
    await vi.waitFor(() => expect(second.sendPrompt).toHaveBeenCalledTimes(1))
    // A third start after the release finds nothing to resume again.
    resetForkPauseAllCacheForTests()
    const third = appStart()
    expect(third.offers.list()).toEqual([])
    expect(await third.holds.release()).toEqual([])
    expect(third.reopen).not.toHaveBeenCalled()
  })

  it('resumes the held worker at the next start when the switch was released while this host was down', async () => {
    const dispatchId = lostWorker()
    writeForkPauseAll(true, { by: 'cli' })
    appStart().recover(dispatchId)
    await heldNoteSaved()
    // Released with no runtime here to hear it (another process removed the file).
    rmSync(join(paths.userData, PAUSE_ALL_STATE_FILE_NAME))
    resetForkPauseAllCacheForTests()
    const next = appStart()
    next.recover(dispatchId)
    await vi.waitFor(() => expect(next.sendPrompt).toHaveBeenCalledTimes(1))
    expect(next.reopen).toHaveBeenCalledTimes(1)
  })

  it('leaves a worker offered for another reason to its person on resume-all', async () => {
    const dispatchId = lostWorker()
    // Offered at a start with Resume work on restart off, before any pause.
    appStart(false).recover(dispatchId)
    writeForkPauseAll(true, { by: 'cli' })
    resetForkPauseAllCacheForTests()
    const next = appStart()
    next.recover(dispatchId)
    expect(next.offers.list()).toHaveLength(1)
    expect(next.offers.list()[0]?.heldReason).toBeUndefined()
    writeForkPauseAll(false, { by: 'cli' })
    await next.holds.release()
    expect(next.reopen).not.toHaveBeenCalled()
    expect(isWorkerRestartOffered(db, dispatchId)).toBe(true)
  })

  it('resumes held workers only once this start has placed its restored terminals, each once', async () => {
    const heldBefore = lostWorker(0)
    writeForkPauseAll(true, { by: 'cli' })
    appStart().recover(heldBefore)
    await heldNoteSaved()
    resetForkPauseAllCacheForTests()
    // The next start: released while it is still restoring terminals, and another lost worker judged.
    const next = appStart()
    writeForkPauseAll(false, { by: 'cli' })
    const lostNow = lostWorker(1)
    next.judgeLost(heldBefore, lostNow)
    await next.holds.release()
    expect(next.reopen).not.toHaveBeenCalled()
    expect(isWorkerRestartOffered(db, heldBefore)).toBe(true)

    next.settle()
    await vi.waitFor(() => expect(next.sendPrompt).toHaveBeenCalledTimes(2))
    next.settle()
    await next.holds.release()
    expect(next.reopen).toHaveBeenCalledTimes(2)
    expect(next.reopen.mock.calls.map((call) => call[2])).toEqual(
      expect.arrayContaining([`${heldBefore}:restart-resume`, `${lostNow}:restart-resume`])
    )
    expect(next.failLost).not.toHaveBeenCalled()
  })

  it('leaves a held worker offered to its person when its released resume fails', async () => {
    const dispatchId = lostWorker()
    writeForkPauseAll(true, { by: 'cli' })
    const start = appStart(
      true,
      vi.fn(async () => null)
    )
    start.recover(dispatchId)
    writeForkPauseAll(false, { by: 'cli' })
    await vi.waitFor(() => expect(start.reopen).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(isWorkerRestartOffered(db, dispatchId)).toBe(true))
    expect(start.failLost).not.toHaveBeenCalled()
    expect(start.offers.list()).toMatchObject([{ sessionId: dispatchId, surface: 'terminal' }])
    // A person's Resume still takes it.
    start.reopen.mockResolvedValue({ handle: 'term_resumed' })
    await expect(start.offers.continue([dispatchId])).resolves.toEqual([
      { sessionId: dispatchId, outcome: 'continued' }
    ])
    expect(start.sendPrompt).toHaveBeenCalledTimes(1)
  })
})
