// BAD-763, BAD-798: a Task's done checks and review on a server that owns its workers. The home
// stores the Task through the real `orchestration.taskCreate` method and starts it through the
// real `--on` route, the real remote-owned start and the real placement tables; the server parses
// the start with the real params schema, creates its Dispatch with the real start step (which
// stores what came with it) and gates the done with the real gate, check runner and reviewer. Only
// the socket between the two runtimes and the server's terminal launch are replaced.
import { afterEach, describe, expect, it } from 'vitest'
import { ORCHESTRATION_REMOTE_OWNED_WORKERS_RUNTIME_CAPABILITY } from '../../../shared/orchestration/orchestration-runtime-capabilities'
import { formatForkContract } from '../../../cli/fork/completion-contract-handlers'
import { readContract } from './contract-store'
import { readReviewGate, listReviewRuns } from '../reviewer-gate/reviewer-store'
import { removeRigFolders, rig, writeMarker } from './remote-owned-contract-rig.test-fixture'

afterEach(removeRigFolders)
describe('a Task made with task-create, started with worker-start --task --on a server that owns its workers', () => {
  it('runs the stored check on the server, in the folder workspace, and stays open until it passes', async () => {
    const r = rig()
    const taskId = await r.taskCreate({ forkDoneChecks: ['test -f marker.txt'] })

    const started = await r.startOnHome({ task: taskId })

    expect(started.taskId).toBe(taskId)
    expect(r.serverStarts[0]).toMatchObject({ forkDoneChecks: ['test -f marker.txt'] })
    const first = await r.workerDone(started.dispatchId)
    expect(first).toMatchObject({
      kind: 'answer',
      receipt: { lifecycle: { action: 'rejected', code: 'done_checks_failed' } }
    })
    // Passes only where the check runs: the folder:<id> workspace's own folder.
    writeMarker(r.folder)
    const second = await r.workerDone(started.dispatchId)
    expect(second).toMatchObject({ kind: 'carry-on', params: { type: 'worker_done' } })

    const shown = await r.showAtHome(taskId)
    expect(shown.attempts.map((attempt) => attempt.outcome)).toEqual(['fail', 'pass'])
    expect(shown.servers).toEqual([{ name: 'build-server', attempts: 2 }])
    expect(formatForkContract(shown)).toContain('server build-server: 2 check attempt(s) ran there')
  })

  it('carries a stored review with its focus, agent and rounds, and the reviewer runs there', async () => {
    const r = rig({ git: true, workerAgent: 'codex' })
    const taskId = await r.taskCreate({
      forkReview: true,
      forkReviewFocus: 'security',
      forkReviewMaxRounds: 3
    })

    const started = await r.startOnHome({ task: taskId })

    expect(readReviewGate(r.serverDb, taskId)?.gate).toEqual({
      focus: 'security',
      agent: null,
      maxRounds: 3
    })
    const held = await r.workerDone(started.dispatchId)
    expect(held).toMatchObject({ kind: 'answer' })
    // A Codex worker is reviewed by the other provider.
    expect(listReviewRuns(r.serverDb, taskId).map((entry) => entry.reviewer)).toEqual(['claude'])
    await expect.poll(() => listReviewRuns(r.serverDb, taskId)[0]?.status).toBe('clean')
    const settled = await r.workerDone(started.dispatchId)
    expect(settled).toMatchObject({ kind: 'carry-on', params: { type: 'worker_done' } })
  })

  it('carries a stored --review-agent as declared', async () => {
    const r = rig({ git: true })
    const taskId = await r.taskCreate({ forkReview: true, forkReviewAgent: 'codex' })

    await r.startOnHome({ task: taskId })

    expect(readReviewGate(r.serverDb, taskId)?.gate.agent).toBe('codex')
  })

  it("lets the start's own flags win over the Task's stored ones, part by part", async () => {
    const r = rig()
    const taskId = await r.taskCreate({
      forkDoneChecks: ['test -f stored.txt'],
      forkReview: true,
      forkReviewFocus: 'perf'
    })

    await r.startOnHome({ task: taskId, forkDoneChecks: ['test -f marker.txt'] })

    expect(readContract(r.serverDb, taskId)?.contract.checks).toEqual(['test -f marker.txt'])
    expect(readContract(r.homeDb, taskId)?.contract.checks).toEqual(['test -f marker.txt'])
    // The start named no review, so the Task's stored one still travels.
    expect(readReviewGate(r.serverDb, taskId)?.gate.focus).toBe('perf')
  })

  it('sends the stored contract again with a --retry-of start of the same Task', async () => {
    const r = rig()
    const taskId = await r.taskCreate({ forkDoneChecks: ['test -f marker.txt'] })
    const first = await r.startOnHome({ task: taskId })
    // The first attempt failed there, and its report reached home; the server forgot the contract.
    r.serverDb.db.prepare('DELETE FROM fork_done_contracts').run()
    r.serverDb.db
      .prepare("UPDATE dispatch_contexts SET status = 'failed' WHERE id = ?")
      .run(first.dispatchId)
    r.serverDb.db
      .prepare("UPDATE worker_dispatches SET state = 'failed' WHERE dispatch_id = ?")
      .run(first.dispatchId)
    for (const db of [r.serverDb, r.homeDb]) {
      db.db.prepare("UPDATE tasks SET status = 'failed' WHERE id = ?").run(taskId)
    }

    await r.startOnHome({ task: taskId, retryOf: first.dispatchId })

    expect(r.serverStarts[1]).toMatchObject({
      task: taskId,
      retryOf: first.dispatchId,
      forkDoneChecks: ['test -f marker.txt']
    })
  })

  it('refuses a server without the contract-carry capability before anything is placed', async () => {
    const r = rig({ serverCapabilities: [ORCHESTRATION_REMOTE_OWNED_WORKERS_RUNTIME_CAPABILITY] })
    const taskId = await r.taskCreate({ forkDoneChecks: ['test -f marker.txt'] })

    await expect(r.startOnHome({ task: taskId })).rejects.toMatchObject({
      code: 'capability_unsupported',
      message: expect.stringContaining(
        "Connected server build-server cannot check this Task's done checks or review"
      )
    })
    expect(r.serverStarts).toEqual([])
    expect(r.homeDb.db.prepare('SELECT COUNT(*) AS n FROM remote_placements').get()).toEqual({
      n: 0
    })
    expect(r.homeDb.getTask(taskId)?.status).toBe('ready')
  })

  it('still starts a Task with no contract on such a server', async () => {
    const r = rig({ serverCapabilities: [ORCHESTRATION_REMOTE_OWNED_WORKERS_RUNTIME_CAPABILITY] })
    const taskId = await r.taskCreate({})

    await r.startOnHome({ task: taskId })

    expect(r.serverStarts).toHaveLength(1)
  })
})

describe('worker-start --spec --done-check on a server that owns its workers', () => {
  it('shows at home the declared check, each attempt and its output tail, live and after it settles', async () => {
    const r = rig()
    const started = await r.startOnHome({
      spec: 'do the work',
      forkDoneChecks: ['test -f marker.txt']
    })

    const live = await r.showAtHome(started.taskId)
    expect(live).toMatchObject({ declared: true, checks: ['test -f marker.txt'] })
    expect(live.servers).toEqual([{ name: 'build-server', attempts: 0 }])

    expect(await r.workerDone(started.dispatchId)).toMatchObject({ kind: 'answer' })
    writeMarker(r.folder)
    expect(await r.workerDone(started.dispatchId)).toMatchObject({ kind: 'carry-on' })

    const settled = await r.showAtHome(started.taskId)
    expect(settled.attempts.map((attempt) => attempt.outcome)).toEqual(['fail', 'pass'])
    expect(settled.attempts[0]!.results[0]).toMatchObject({ ok: false, exitCode: 1 })
    const text = formatForkContract(settled)
    expect(text).toContain('check: test -f marker.txt')
    expect(text).not.toContain('declares no done checks')
  })

  it('names a server too old to show its evidence rather than saying no checks were declared', async () => {
    const r = rig({ serverHasShow: false })
    const started = await r.startOnHome({
      spec: 'do the work',
      forkDoneChecks: ['test -f marker.txt']
    })
    // A Task the home never stored a contract for (started before this build).
    r.homeDb.db.prepare('DELETE FROM fork_done_contracts').run()

    const shown = await r.showAtHome(started.taskId)

    expect(shown.declared).toBe(false)
    const text = formatForkContract(shown)
    expect(text).toContain('server build-server: cannot see its check evidence')
    expect(text).not.toContain('declares no done checks')
  })
})

describe('forkReviewerGateAllTasks on at home, a plain worker-start --on a server that owns its workers', () => {
  const ALL_TASKS = { forkReviewerGateAllTasks: true, forkReviewerGateMaxRounds: 4 }

  it('is reviewed on the server before it settles, with the home rounds', async () => {
    const r = rig({ git: true, homeSettings: ALL_TASKS })

    const started = await r.startOnHome({ spec: 'do the work' })

    expect(r.serverStarts[0]).toMatchObject({
      forkReview: true,
      forkReviewFocus: 'correctness',
      forkReviewMaxRounds: 4
    })
    expect(readReviewGate(r.serverDb, started.taskId)).toMatchObject({ implicit: false })
    expect(await r.workerDone(started.dispatchId)).toMatchObject({
      kind: 'answer',
      receipt: { lifecycle: { code: 'review_pending' } }
    })
    expect(listReviewRuns(r.serverDb, started.taskId).map((run) => run.reviewer)).toEqual(['codex'])
    await expect.poll(() => listReviewRuns(r.serverDb, started.taskId)[0]?.status).toBe('clean')
    expect(await r.workerDone(started.dispatchId)).toMatchObject({ kind: 'carry-on' })
  })

  it('sends the review again with --retry-of after the setting was turned off', async () => {
    const r = rig({ homeSettings: { ...ALL_TASKS } })
    const first = await r.startOnHome({ spec: 'do the work' })
    r.homeSettings!.forkReviewerGateAllTasks = false
    r.serverDb.db.prepare('DELETE FROM fork_review_gates').run()
    r.serverDb.db
      .prepare("UPDATE dispatch_contexts SET status = 'failed' WHERE id = ?")
      .run(first.dispatchId)
    r.serverDb.db
      .prepare("UPDATE worker_dispatches SET state = 'failed' WHERE dispatch_id = ?")
      .run(first.dispatchId)
    for (const db of [r.serverDb, r.homeDb]) {
      db.db.prepare("UPDATE tasks SET status = 'failed' WHERE id = ?").run(first.taskId)
    }

    await r.startOnHome({ task: first.taskId, retryOf: first.dispatchId })

    expect(r.serverStarts[1]).toMatchObject({ retryOf: first.dispatchId, forkReview: true })
  })

  it('refuses a server without the capability before anything is placed, naming the setting', async () => {
    const r = rig({
      serverCapabilities: [ORCHESTRATION_REMOTE_OWNED_WORKERS_RUNTIME_CAPABILITY],
      homeSettings: ALL_TASKS
    })

    const refusal = r.startOnHome({ spec: 'do the work' })

    await expect(refusal).rejects.toMatchObject({
      code: 'capability_unsupported',
      message: expect.stringContaining('forkReviewerGateAllTasks')
    })
    await expect(refusal).rejects.toMatchObject({
      message: expect.stringContaining('No effects were applied')
    })
    expect(r.serverStarts).toEqual([])
    expect(r.homeDb.db.prepare('SELECT COUNT(*) AS n FROM remote_placements').get()).toEqual({
      n: 0
    })
    expect(r.homeDb.db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 0 })
  })

  it('with the setting off sends the same start as with no settings', async () => {
    const off = rig({ homeSettings: { forkReviewerGateAllTasks: false } })
    const none = rig()
    await off.startOnHome({ spec: 'do the work' })
    await none.startOnHome({ spec: 'do the work' })

    expect(Object.keys(off.serverStarts[0]!).filter((key) => key.startsWith('fork'))).toEqual([])
    expect(JSON.stringify(off.serverStarts[0])).toBe(JSON.stringify(none.serverStarts[0]))
  })
})
