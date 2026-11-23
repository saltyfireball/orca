// BAD-763: the contract and review request travel with the work. Two orchestration databases stand
// for the Run home and a paired server; the server's gate runs real commands in a real folder.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import '../../runtime/orchestration/db/contract-constants'
import '../../runtime/orchestration/db/messages/mailbox-routing-page'
import '../../runtime/orchestration/db/dispatch-row-writer'
import '../../runtime/orchestration/db/attempt-outcome-projection'
import { createRootDispatch } from '../../runtime/orchestration/db/root-dispatch-test-fixture'
import { sendRemoteMessage } from '../../runtime/orchestration/legacy-remote/send-remote'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { forkStoreDoneContract } from './completion-gate-live'
import { forkStartCarriesContract, forkTaskContractWire } from './contract-carry'
import { showWithServerEvidence } from './contract-show'
import { readContract, saveContract } from './contract-store'
import { readReviewGate, saveReviewGate } from '../reviewer-gate/reviewer-store'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function home() {
  const db = new OrchestrationDb(':memory:')
  const run = db.createRun({
    objective: 'carry',
    coordinatorHandle: 'term_coordinator',
    coordinatorPaneKey: 'tab-c::22222222-2222-4222-8222-222222222222' as never
  })
  return { db, run }
}

describe('a retry or follow-up continues the contract of the Task it continues', () => {
  it('copies the checks and the review request to the new Task, rounds at zero', () => {
    const { db, run } = home()
    const first = db.createTask({ spec: 'build it', runId: run.id })
    const dispatch = createRootDispatch(db, first.id, 'term_worker')
    saveContract(db, first.id, { checks: ['pnpm test'], requirePrChecks: true, maxRounds: 3 })
    saveReviewGate(db, first.id, { focus: 'security', agent: 'codex', maxRounds: 1 })
    const next = db.createTask({ spec: 'build it again', runId: run.id })

    forkStoreDoneContract(db, next.id, {}, dispatch.id)

    expect(readContract(db, next.id)).toMatchObject({
      contract: { checks: ['pnpm test'], requirePrChecks: true, maxRounds: 3 },
      failedRounds: 0,
      escalated: false
    })
    expect(readReviewGate(db, next.id)?.gate).toEqual({
      focus: 'security',
      agent: 'codex',
      maxRounds: 1
    })
  })

  it('leaves a contract the new start declared for itself alone', () => {
    const { db, run } = home()
    const first = db.createTask({ spec: 'a', runId: run.id })
    const dispatch = createRootDispatch(db, first.id, 'term_worker')
    saveContract(db, first.id, { checks: ['old'], requirePrChecks: false, maxRounds: null })
    const next = db.createTask({ spec: 'b', runId: run.id })

    forkStoreDoneContract(db, next.id, { forkDoneChecks: ['new'] }, dispatch.id)

    expect(readContract(db, next.id)?.contract.checks).toEqual(['new'])
  })

  it('carries nothing from a Task that declared nothing', () => {
    const { db, run } = home()
    const first = db.createTask({ spec: 'a', runId: run.id })
    const dispatch = createRootDispatch(db, first.id, 'term_worker')
    const next = db.createTask({ spec: 'b', runId: run.id })
    forkStoreDoneContract(db, next.id, {}, dispatch.id)
    expect(forkTaskContractWire(db, next.id)).toBeNull()
  })
})

describe('forkStartCarriesContract', () => {
  it('sees a declared, a stored and an inherited contract, and none', () => {
    const { db, run } = home()
    const task = db.createTask({ spec: 'a', runId: run.id })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')
    expect(forkStartCarriesContract(db, { params: {} })).toBe(false)
    expect(forkStartCarriesContract(db, { params: { forkDoneChecks: ['x'] } })).toBe(true)
    expect(forkStartCarriesContract(db, { params: { forkReview: true } })).toBe(true)
    expect(forkStartCarriesContract(db, { params: {}, taskId: task.id })).toBe(false)
    saveContract(db, task.id, { checks: ['x'], requirePrChecks: false, maxRounds: null })
    expect(forkStartCarriesContract(db, { params: {}, taskId: task.id })).toBe(true)
    expect(forkStartCarriesContract(db, { params: {}, continuesDispatchId: dispatch.id })).toBe(
      true
    )
  })
})

describe('a Task started on a paired server is checked there', () => {
  function rig(check: string, settings: object = {}) {
    const folder = mkdtempSync(join(tmpdir(), 'carry-folder-'))
    dirs.push(folder)
    const homeRig = home()
    // Declared at home with task-create, started on the server with worker-start --on.
    const task = homeRig.db.createTask({ spec: 'do the work', runId: homeRig.run.id })
    saveContract(homeRig.db, task.id, { checks: [check], requirePrChecks: false, maxRounds: 2 })
    const dispatch = createRootDispatch(homeRig.db, task.id, 'term_worker')
    homeRig.db.db
      .prepare(
        `INSERT INTO federated_dispatches (dispatch_id, environment_id, environment_name, peer_fingerprint)
         VALUES (?, 'env_1', 'build-server', 'fp_server')`
      )
      .run(dispatch.id)

    // What the home sends in the attach-start, read as the server reads it.
    const wire = forkTaskContractWire(homeRig.db, task.id)
    expect(wire).toEqual({ forkDoneChecks: [check], forkDoneMaxRounds: 2 })
    const server = new OrchestrationDb(':memory:')
    server.createRemoteDispatchAttachment({
      runId: homeRig.run.id,
      dispatchId: dispatch.id,
      taskId: task.id,
      homePeerFingerprint: 'fp_home',
      protocolVersion: 1,
      runtimeEpoch: 'epoch_1',
      mutationReceipt: {
        callerFingerprint: 'fp_home',
        requestId: 'req_1',
        method: 'orchestration.federationAttachStart',
        payloadHash: 'hash_1'
      }
    })
    forkStoreDoneContract(server, task.id, wire)
    server.db
      .prepare(
        `UPDATE remote_dispatch_attachments
            SET state = 'ready', worktree_id = 'wt_folder', pane_key = 'tab-w::pane', process_incarnation = 'pid-1'
          WHERE dispatch_id = ?`
      )
      .run(dispatch.id)

    // The server's project is a plain folder: the checks must still run, in that folder.
    const runtime = {
      requireStore: () => ({
        getSettings: () => settings,
        getRepo: () => ({ id: 'repo_1', kind: 'folder', path: folder }),
        getRepos: () => [],
        getProjectGroups: () => []
      }),
      resolveRuntimeFileTarget: async () => ({
        worktree: { repoId: 'repo_1', path: folder, git: { branch: '' } },
        executionHostId: 'local'
      })
    } as unknown as OrcaRuntimeService
    const attachment = server.getRemoteDispatchAttachment(dispatch.id)!
    const report = () =>
      sendRemoteMessage({
        params: {
          type: 'worker_done',
          subject: 'done',
          body: 'all finished',
          payload: JSON.stringify({ outcome: 'succeeded', dispatchId: dispatch.id })
        } as never,
        runtime,
        db: server,
        from: 'term_worker',
        senderPaneKey: 'tab-w::pane',
        remoteAttachment: attachment,
        processIncarnation: 'pid-1'
      })
    const relayed = () =>
      server.db.prepare('SELECT payload FROM federation_relay_items').all() as { payload: string }[]
    return { homeRig, server, task, dispatch, report, relayed, folder }
  }

  const callServer =
    (server: OrchestrationDb) => async (_env: string, method: string, p: unknown) => {
      expect(method).toBe('fork.completionContract.show')
      const { showContractOf } = await import('./contract-show')
      return showContractOf(server, (p as { task: string }).task)
    }

  it('turns a failing check back to the worker and sends nothing home', async () => {
    const { server, homeRig, task, report, relayed } = rig('echo broken >&2; exit 1')
    const answer = (await report()) as {
      lifecycle: { action: string; code: string; reason: string }
    }
    expect(answer.lifecycle).toMatchObject({ action: 'rejected', code: 'done_checks_failed' })
    expect(answer.lifecycle.reason).toContain('broken')
    expect(relayed()).toHaveLength(0)
    expect(homeRig.db.getTask(task.id)?.status).not.toBe('completed')

    // `orca contract show` at home reads the evidence from the server that ran the check.
    const shown = await showWithServerEvidence(homeRig.db, task.id, callServer(server))
    expect(shown.attempts).toHaveLength(1)
    expect(shown.attempts[0]).toMatchObject({ outcome: 'fail' })
    expect(shown.attempts[0]!.results[0]).toMatchObject({ ok: false, exitCode: 1 })
    expect(shown.failedRounds).toBe(1)
    expect(shown.servers).toEqual([{ name: 'build-server', attempts: 1 }])
  })

  it('sends the done home with the evidence once the check passes', async () => {
    const { server, homeRig, task, report, relayed } = rig('test "$(pwd -P)" != ""')
    await report()
    const items = relayed()
    expect(items).toHaveLength(1)
    expect(JSON.parse(items[0]!.payload).body).toContain('all finished')
    expect(JSON.parse(items[0]!.payload).body).toMatch(/test|check/i)
    const shown = await showWithServerEvidence(homeRig.db, task.id, callServer(server))
    expect(shown.attempts.map((a) => a.outcome)).toEqual(['pass'])
  })

  it('runs a folder project check in that folder: a marker file there is found, a missing one is not', async () => {
    const found = rig('test -f folder-marker.txt')
    writeFileSync(join(found.folder, 'folder-marker.txt'), 'here')
    await found.report()
    expect(found.relayed()).toHaveLength(1)

    const missing = rig('test -f folder-marker.txt')
    const answer = (await missing.report()) as { lifecycle: { code: string } }
    expect(answer.lifecycle.code).toBe('done_checks_failed')
    expect(missing.relayed()).toHaveLength(0)
  })

  it('sends the done home with a line saying the checks did not run when the server has them off', async () => {
    const { server, homeRig, task, report, relayed } = rig('exit 1', {
      forkCompletionContract: false
    })
    await report()
    const body = JSON.parse(relayed()[0]!.payload).body as string
    expect(body).toContain('all finished')
    expect(body).toMatch(
      /Orca did not run this Task's 1 declared done check\(s\).*forkCompletionContract.*\(on .+\)\./
    )
    const shown = await showWithServerEvidence(homeRig.db, task.id, callServer(server))
    expect(shown.attempts.map((a) => a.outcome)).toEqual(['skipped'])
  })

  it('escalates to the Run home when the checks keep failing', async () => {
    const { report, relayed } = rig('exit 3')
    await report()
    await report()
    const third = await report()
    expect(third).toMatchObject({ relay: { accepted: true } })
    const items = relayed()
    expect(items).toHaveLength(1)
    expect(JSON.parse(items[0]!.payload)).toMatchObject({ type: 'escalation' })
  })

  it('says so when the server cannot be asked for its evidence', async () => {
    const { homeRig, task } = rig('true')
    const shown = await showWithServerEvidence(homeRig.db, task.id, async () => {
      throw new Error('the paired server did not answer')
    })
    expect(shown.servers).toEqual([
      { name: 'build-server', attempts: 0, error: 'the paired server did not answer' }
    ])
  })
})
