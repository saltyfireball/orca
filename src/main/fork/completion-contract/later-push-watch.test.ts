// BAD-676 "a later push re-evaluates": a Task with --require-pr-checks settles through the real gate
// and the real worker report settle; after that, the watch the database's own changes arm reads the
// pull request again. Only gh and git are stood in for: they answer from one pull request below.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import '../../runtime/orchestration/db/contract-constants'
import '../../runtime/orchestration/db/messages/mailbox-routing-page'
import '../../runtime/orchestration/db/dispatch-row-writer'
import '../../runtime/orchestration/db/attempt-outcome-projection'
import { createRootDispatch } from '../../runtime/orchestration/db/root-dispatch-test-fixture'
import { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { forkGateWorkerDone } from './completion-gate-live'
import { listAttempts, saveContract } from './contract-store'
import { contractInboxItems } from './contract-inbox'
import { readWatch } from './later-push-store'
import { forkLaterPushReadOnServer, installForkLaterPushWatch } from './later-push-live'

const pr = vi.hoisted(() => ({
  number: 7,
  state: 'OPEN',
  head: '',
  checks: [] as { name: string; bucket: string }[],
  calls: 0
}))
vi.mock('../../git/command-runner/hosted-cli/gh-exec-file', () => ({
  ghExecFileAsync: async (args: string[]) => {
    pr.calls++
    if (args[1] === 'view') {
      return {
        stdout: JSON.stringify({
          number: pr.number,
          state: pr.state,
          headRefOid: pr.head,
          statusCheckRollup: []
        })
      }
    }
    return { stdout: JSON.stringify(pr.checks) }
  }
}))
vi.mock('../../git/command-runner/git-exec-file', () => ({
  gitExecFileAsync: async () => ({ stdout: `${pr.head}\n` })
}))

const H1 = '1'.repeat(40)
const H2 = '2'.repeat(40)
const H3 = '3'.repeat(40)
const MINUTE = 60_000

function push(head: string, bucket: 'pass' | 'fail' | 'pending', name = 'ci'): void {
  pr.head = head
  pr.checks = [{ name, bucket }]
}

let settings: Record<string, unknown> = {}
const dirs: string[] = []
const dbs: OrchestrationDb[] = []

function runtimeFor(
  getDb: () => OrchestrationDb,
  call?: OrcaRuntimeService['callOrchestrationWorkerServer']
) {
  return {
    getOrchestrationDb: getDb,
    notifyMessageArrived: vi.fn(),
    callOrchestrationWorkerServer:
      call ??
      (async () => {
        throw new Error('no paired server here')
      }),
    requireStore: () => ({
      getSettings: () => settings,
      getRepo: () => ({ id: 'repo_1', kind: 'git', path: '/work/app' }),
      getRepos: () => [],
      getProjectGroups: () => []
    }),
    resolveRuntimeFileTarget: async (selector: string) => {
      if (selector === 'id:wt_gone') {
        throw new Error('no such worktree')
      }
      return {
        worktree: { repoId: 'repo_1', path: '/work/app', git: { branch: 'feature/x' } },
        executionHostId: 'local'
      }
    }
  } as unknown as OrcaRuntimeService
}

function open(path = ':memory:') {
  const db = new OrchestrationDb(path)
  dbs.push(db)
  return db
}

function rig(options: { contract?: boolean; path?: string } = {}) {
  const db = open(options.path)
  const run = db.createRun({
    objective: 'later push',
    coordinatorHandle: 'term_coordinator',
    coordinatorPaneKey: 'tab-c::22222222-2222-4222-8222-222222222222' as never
  })
  const task = db.createTask({ spec: 'ship the change', runId: run.id })
  const dispatch = createRootDispatch(db, task.id, 'term_worker')
  db.db
    .prepare(
      "INSERT INTO worker_dispatches (dispatch_id, state, worktree_id, start_options, updated_at) VALUES (?, 'ready', 'wt_1', '{}', datetime('now'))"
    )
    .run(dispatch.id)
  if (options.contract !== false) {
    saveContract(db, task.id, { checks: [], requirePrChecks: true, maxRounds: null })
  }
  let current = db
  const runtime = runtimeFor(() => current)
  installForkLaterPushWatch(runtime, db)
  return {
    db,
    task,
    dispatch,
    runtime,
    /** The worker's done, through the gate the send handler calls, then the real settle. */
    settle: async () => {
      const gated = await forkGateWorkerDone(
        runtime,
        db,
        {
          type: 'worker_done',
          subject: 'done',
          payload: JSON.stringify({ outcome: 'succeeded', dispatchId: dispatch.id })
        },
        dispatch.id
      )
      expect(gated.kind).toBe('carry-on')
      expect(
        db.settleWorkerReport({
          taskId: task.id,
          dispatchId: dispatch.id,
          outcome: 'succeeded',
          result: 'done'
        })
      ).toMatchObject({ action: 'settled' })
    },
    swap: (next: OrchestrationDb) => {
      current = next
    }
  }
}

function escalations(db: OrchestrationDb) {
  return db.db
    .prepare("SELECT id, subject, body FROM messages WHERE type = 'escalation' ORDER BY rowid")
    .all() as { id: string; subject: string; body: string }[]
}

const outcomes = (db: OrchestrationDb, taskId: string) =>
  listAttempts(db, taskId).map((attempt) => attempt.outcome)

beforeEach(() => {
  vi.useFakeTimers()
  settings = {}
  pr.state = 'OPEN'
  pr.calls = 0
  push(H1, 'pass')
})
afterEach(() => {
  vi.useRealTimers()
  for (const db of dbs.splice(0)) {
    db.close()
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('a push after a --require-pr-checks Task settled', () => {
  it('stays quiet while green, then sends one escalation and an inbox row for a red push', async () => {
    const { db, task, settle } = rig()
    await settle()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(readWatch(db, task.id)).toMatchObject({ ended: null })

    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(outcomes(db, task.id)).toEqual(['pass'])
    expect(escalations(db)).toEqual([])

    push(H2, 'pending')
    await vi.advanceTimersByTimeAsync(2 * MINUTE)
    expect(outcomes(db, task.id)).toEqual(['pass'])
    expect(escalations(db)).toEqual([])

    push(H2, 'fail', 'lint `rm -rf`')
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(outcomes(db, task.id)).toEqual(['pass', 'fail'])
    const [sent] = escalations(db)
    expect(escalations(db)).toHaveLength(1)
    expect(sent!.subject).toBe(`Pull request checks failed after the Task settled: ${task.id}`)
    expect(sent!.body).toContain('Pull request #7 is now at 2222222222')
    expect(sent!.body).toContain('Orca did not reopen or change the settled Task')
    // The check name is GitHub's text: fenced longer than any backtick run in it.
    expect(sent!.body).toContain('``text\nlint `rm -rf`\n``')
    expect(contractInboxItems({ db: db.db, taskStatus: () => 'completed' })).toMatchObject([
      { chatId: `contract-push:${task.id}`, source: 'contract' }
    ])

    await vi.advanceTimersByTimeAsync(90 * MINUTE)
    expect(escalations(db)).toHaveLength(1)
    expect(db.getTask(task.id)?.status).toBe('completed')
  })

  it('records the fixed push as a pass and sends nothing more', async () => {
    const { db, task, settle } = rig()
    await settle()
    push(H2, 'fail')
    await vi.advanceTimersByTimeAsync(MINUTE + 3_000)
    expect(escalations(db)).toHaveLength(1)

    push(H3, 'pass')
    await vi.advanceTimersByTimeAsync(2 * MINUTE)
    expect(outcomes(db, task.id)).toEqual(['pass', 'fail', 'pass'])
    expect(listAttempts(db, task.id).at(-1)!.results[0]).toMatchObject({ headSha: H3, ok: true })
    expect(escalations(db)).toHaveLength(1)
  })

  it('stops reading once the pull request is merged', async () => {
    const { db, task, settle } = rig()
    await settle()
    pr.state = 'MERGED'
    await vi.advanceTimersByTimeAsync(MINUTE + 3_000)
    expect(readWatch(db, task.id)?.ended).toBe('pull request #7 is merged')
    const calls = pr.calls
    push(H2, 'fail')
    await vi.advanceTimersByTimeAsync(5 * 60 * MINUTE)
    expect(pr.calls).toBe(calls)
    expect(escalations(db)).toEqual([])
  })

  it('stops at the time limit, and a limit of 0 arms nothing', async () => {
    settings = { forkCompletionContractLaterPushHours: 1 }
    const { db, task, settle } = rig()
    await settle()
    await vi.advanceTimersByTimeAsync(61 * MINUTE)
    expect(readWatch(db, task.id)?.ended).toBe('the time limit after the settle passed')
    const calls = pr.calls
    push(H2, 'fail')
    await vi.advanceTimersByTimeAsync(5 * 60 * MINUTE)
    expect(pr.calls).toBe(calls)
    expect(escalations(db)).toEqual([])

    settings = { forkCompletionContractLaterPushHours: 0 }
    push(H1, 'pass')
    const off = rig()
    await off.settle()
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(readWatch(off.db, off.task.id)).toBeNull()
  })

  it('keeps watching across an app restart and still sends the red head once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'later-push-'))
    dirs.push(dir)
    const path = join(dir, 'orchestration.db')
    // Each "process" is a real runtime that opens the database file the way the app does.
    const boot = () => {
      const runtime = new OrcaRuntimeService(null)
      const stand = runtimeFor(() => runtime.getOrchestrationDb())
      vi.spyOn(
        runtime as unknown as { orchestrationDbPath: () => string },
        'orchestrationDbPath'
      ).mockReturnValue(path)
      vi.spyOn(runtime, 'requireStore').mockImplementation(stand.requireStore)
      vi.spyOn(runtime, 'resolveRuntimeFileTarget').mockImplementation(
        stand.resolveRuntimeFileTarget
      )
      const db = runtime.getOrchestrationDb()
      dbs.push(db)
      return { runtime, db }
    }
    const first = boot()
    const run = first.db.createRun({
      objective: 'later push',
      coordinatorHandle: 'term_coordinator',
      coordinatorPaneKey: 'tab-c::22222222-2222-4222-8222-222222222222' as never
    })
    const task = first.db.createTask({ spec: 'ship the change', runId: run.id })
    const dispatch = createRootDispatch(first.db, task.id, 'term_worker')
    first.db.db
      .prepare(
        "INSERT INTO worker_dispatches (dispatch_id, state, worktree_id, start_options, updated_at) VALUES (?, 'ready', 'wt_1', '{}', datetime('now'))"
      )
      .run(dispatch.id)
    saveContract(first.db, task.id, { checks: [], requirePrChecks: true, maxRounds: null })
    const gated = await forkGateWorkerDone(
      first.runtime,
      first.db,
      {
        type: 'worker_done',
        subject: 'done',
        payload: JSON.stringify({ outcome: 'succeeded', dispatchId: dispatch.id })
      },
      dispatch.id
    )
    expect(gated.kind).toBe('carry-on')
    first.db.settleWorkerReport({
      taskId: task.id,
      dispatchId: dispatch.id,
      outcome: 'succeeded',
      result: 'done'
    })
    await vi.advanceTimersByTimeAsync(3_000)
    expect(readWatch(first.db, task.id)).toMatchObject({ ended: null })
    first.db.close()
    dbs.splice(dbs.indexOf(first.db), 1)

    push(H2, 'fail')
    const second = boot()
    await vi.advanceTimersByTimeAsync(2 * MINUTE)
    expect(escalations(second.db)).toHaveLength(1)
    second.db.close()
    dbs.splice(dbs.indexOf(second.db), 1)

    const third = boot()
    await vi.advanceTimersByTimeAsync(60 * MINUTE)
    expect(escalations(third.db)).toHaveLength(1)
  })

  it('arms nothing and reads nothing for a Task without the contract', async () => {
    const { db, task, settle } = rig({ contract: false })
    await settle()
    push(H2, 'fail')
    await vi.advanceTimersByTimeAsync(60 * MINUTE)
    expect(readWatch(db, task.id)).toBeNull()
    expect(pr.calls).toBe(0)
    expect(escalations(db)).toEqual([])
  })

  it('sends nothing while a follow-up of the worker works on the same pull request', async () => {
    const { db, task, dispatch, settle } = rig()
    await settle()
    const next = db.createTask({ spec: 'fix the push', runId: task.run_id })
    const followUp = createRootDispatch(db, next.id, 'term_worker')
    db.db
      .prepare('UPDATE dispatch_contexts SET follow_up_of_dispatch_id = ? WHERE id = ?')
      .run(dispatch.id, followUp.id)
    push(H2, 'fail')
    await vi.advanceTimersByTimeAsync(30 * MINUTE)
    expect(escalations(db)).toEqual([])
    expect(outcomes(db, task.id)).toEqual(['pass'])
  })
})

describe('a Task whose worker ran on a paired server', () => {
  it('is read by that server, and the message reaches the Run home', async () => {
    const server = open()
    const home = open()
    const run = home.createRun({
      objective: 'later push',
      coordinatorHandle: 'term_coordinator',
      coordinatorPaneKey: 'tab-c::22222222-2222-4222-8222-222222222222' as never
    })
    const task = home.createTask({ spec: 'ship it on the server', runId: run.id })
    const dispatch = createRootDispatch(home, task.id, 'term_worker')
    home.db
      .prepare(
        `INSERT INTO federated_dispatches (dispatch_id, environment_id, environment_name, peer_fingerprint, remote_worktree_id)
         VALUES (?, 'env_1', 'build-server', 'fp_server', 'wt_remote')`
      )
      .run(dispatch.id)
    saveContract(home, task.id, { checks: [], requirePrChecks: true, maxRounds: null })
    server.createRemoteDispatchAttachment({
      runId: run.id,
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
    server.db
      .prepare(
        "UPDATE remote_dispatch_attachments SET state = 'succeeded', worktree_id = 'wt_remote' WHERE dispatch_id = ?"
      )
      .run(dispatch.id)
    saveContract(server, task.id, { checks: [], requirePrChecks: true, maxRounds: null })
    const serverRuntime = runtimeFor(() => server)
    const asked: string[] = []
    const homeRuntime = runtimeFor(
      () => home,
      async (environmentId, method, params) => {
        asked.push(`${environmentId} ${method}`)
        return forkLaterPushReadOnServer(serverRuntime, server, (params as { task: string }).task)
      }
    )
    installForkLaterPushWatch(homeRuntime, home)
    // The server's gate passed and its done settled the Task at home.
    expect(
      home.settleWorkerReport({
        taskId: task.id,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        result: 'done'
      })
    ).toMatchObject({ action: 'settled' })

    push(H2, 'fail')
    await vi.advanceTimersByTimeAsync(MINUTE + 3_000)
    expect(asked).toEqual(['env_1 fork.completionContract.laterPush'])
    expect(outcomes(server, task.id)).toEqual(['fail'])
    expect(listAttempts(home, task.id)).toEqual([])
    expect(escalations(home)).toHaveLength(1)
    expect(escalations(server)).toEqual([])
  })
})
