// BAD-763, BAD-798: a Task's done checks and review on a server that owns its workers. The home
// stores the Task through the real `orchestration.taskCreate` method and starts it through the
// real `--on` route, the real remote-owned start and the real placement tables; the server parses
// the start with the real params schema, creates its Dispatch with the real start step (which
// stores what came with it) and gates the done with the real gate, check runner and reviewer. Only
// the socket between the two runtimes and the server's terminal launch are replaced.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import '../../runtime/orchestration/db/contract-constants'
import '../../runtime/orchestration/db/messages/mailbox-routing-page'
import '../../runtime/orchestration/db/dispatch-row-writer'
import '../../runtime/orchestration/db/attempt-outcome-projection'
import {
  ORCHESTRATION_FORK_CONTRACT_CARRY_RUNTIME_CAPABILITY,
  ORCHESTRATION_REMOTE_OWNED_WORKERS_RUNTIME_CAPABILITY
} from '../../../shared/orchestration/orchestration-runtime-capabilities'
import { WorkerStartParams } from '../../../shared/rpc-contract/orchestration/orchestration-worker-start-params'
import { folderWorkspaceRepoId } from '../../../shared/folder-workspaces/folder-workspace-worktree'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { RpcContext, RpcMethod, RpcRequest } from '../../runtime/rpc/core'
import { formatForkContract } from '../../../cli/fork/completion-contract-handlers'
import { forkGateWorkerDone } from './completion-gate-live'
import { readContract } from './contract-store'
import { readReviewGate, listReviewRuns } from '../reviewer-gate/reviewer-store'
import { FORK_COMPLETION_CONTRACT_METHODS } from '../../runtime/rpc/methods/fork/fork-completion-contract'
import { ORCHESTRATION_MESSAGE_METHODS } from '../../runtime/rpc/methods/orchestration/messaging/message-methods'
import { ORCHESTRATION_WORKER_START_METHODS } from '../../runtime/rpc/methods/orchestration/worker/worker-start-method'
import { routeRemoteOwnedCall } from '../../runtime/orchestration/federation/remote-owned/remote-owned-route'
import { createLocalWorkerStartDispatch } from '../../runtime/rpc/methods/orchestration/worker/start/local-worker-start-dispatch'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const COORDINATOR = 'term_coordinator'
const COORDINATOR_PANE = 'tab-c::22222222-2222-4222-8222-222222222222'

const server = {
  environmentId: 'env-1',
  name: 'build-server',
  peerFingerprint: 'peer-1',
  pairingRevision: 1
}

function method(list: readonly unknown[], name: string): RpcMethod {
  const found = (list as RpcMethod[]).find((entry) => entry.name === name)
  if (!found) {
    throw new Error(`no ${name}`)
  }
  return found
}

const showMethod = () => method(FORK_COMPLETION_CONTRACT_METHODS, 'fork.completionContract.show')

type RigOptions = {
  serverCapabilities?: string[]
  serverHasShow?: boolean
  /** A git checkout (the reviewer needs a commit) instead of a project group's folder workspace. */
  git?: boolean
  workerAgent?: string
  /** The home's settings; the server keeps its own reviewer commands and has the all-Tasks setting off. */
  homeSettings?: Record<string, unknown>
}

function rig(options: RigOptions = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'remote-owned-contract-'))
  dirs.push(folder)
  if (options.git) {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: folder, stdio: 'ignore' })
    git('init', '-q')
    writeFileSync(join(folder, 'readme.txt'), 'work')
    git('add', '.')
    git(
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'one'
    )
  }
  const homeDb = new OrchestrationDb(':memory:')
  const run = homeDb.createRun({
    objective: 'carry',
    coordinatorHandle: COORDINATOR,
    coordinatorPaneKey: COORDINATOR_PANE as never
  })
  const serverDb = new OrchestrationDb(':memory:')
  const capabilities = options.serverCapabilities ?? [
    ORCHESTRATION_REMOTE_OWNED_WORKERS_RUNTIME_CAPABILITY,
    ORCHESTRATION_FORK_CONTRACT_CARRY_RUNTIME_CAPABILITY
  ]
  // A folder:<id> workspace names its project group in repoId, which getRepo never finds.
  const repoId = options.git ? 'repo_1' : folderWorkspaceRepoId('group_1')
  const serverSettings = {
    forkReviewerClaudeCommand: 'echo VERDICT: CLEAN',
    forkReviewerCodexCommand: 'echo VERDICT: CLEAN'
  }
  const serverRuntime = {
    getOrchestrationDb: () => serverDb,
    getRuntimeId: () => 'runtime_server',
    getNestedWorkerMaxDepth: () => 4,
    getTerminalPaneKey: () => null,
    requireStore: () => ({
      getSettings: () => serverSettings,
      getRepo: (id: string) =>
        options.git && id === 'repo_1' ? { id, kind: 'git', path: folder } : undefined,
      getRepos: () => [],
      getProjectGroups: () => []
    }),
    resolveRuntimeFileTarget: async () => ({
      worktree: { repoId, path: folder, git: { branch: options.git ? 'main' : '' } },
      executionHostId: 'local'
    })
  } as unknown as OrcaRuntimeService

  const serverStarts: Record<string, unknown>[] = []
  /** The server's side of `orchestration.workerStart`: its params schema and its ordinary dispatch creation. */
  const startOnServer = (raw: Record<string, unknown>) => {
    // The server's dispatcher names the peer Run's coordinator as the caller (orchestration-peer-caller.ts).
    const params = WorkerStartParams.parse({ ...raw, from: 'run:peer' })
    serverStarts.push(params)
    const peerRun = serverDb.createRun({
      objective: 'peer',
      coordinatorHandle: 'term_peer',
      coordinatorPaneKey: 'tab-p::33333333-3333-4333-8333-333333333333' as never
    })
    const existingTask = params.task ? serverDb.getTask(params.task) : undefined
    const started = createLocalWorkerStartDispatch(
      {
        runtime: serverRuntime,
        db: serverDb,
        taskDeps: undefined,
        coordinator: null,
        callerSession: undefined,
        existingTask,
        orchestrationMutation: undefined,
        helperCreator: undefined,
        followUp: undefined,
        chatLineage: undefined,
        params
      } as never,
      {
        params,
        run: peerRun,
        requestedWorktree: 'new-top-level',
        createsWorktree: false,
        mode: 'terminal',
        resolvedWorktreeId: 'folder:ws_1',
        repoSelector: undefined,
        agent: options.workerAgent ?? 'claude',
        launchReceipt: {}
      } as never
    )
    // The launch step binds the worker to its workspace; the checks run there.
    serverDb.db
      .prepare('UPDATE worker_dispatches SET worktree_id = ? WHERE dispatch_id = ?')
      .run('folder:ws_1', started.dispatch.id)
    return { dispatchId: started.dispatch.id, run: { id: peerRun.id }, state: 'ready' }
  }

  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the home's start reads only these members.
  const homeRuntime = {
    getOrchestrationDb: () => homeDb,
    resolveOrchestrationWorkerServer: async () => server,
    ensureOrchestrationFederationRelay: () => undefined,
    notifyMessageArrived: () => undefined,
    readMachineName: () => 'home',
    getRuntimeId: () => 'runtime_home',
    getTerminalPaneKey: (handle: string) => (handle === COORDINATOR ? COORDINATOR_PANE : null),
    getOrchestrationDispatchAuthority: () => null,
    bots: { list: () => [] },
    ...(options.homeSettings
      ? { requireStore: () => ({ getSettings: () => options.homeSettings }) }
      : {}),
    callOrchestrationWorkerServer: async (_env: string, name: string, params: unknown) => {
      if (name === 'status.get') {
        return { runtimeId: 'runtime_server', capabilities }
      }
      if (name === 'orchestration.workerStart') {
        return startOnServer(params as Record<string, unknown>)
      }
      if (name === 'fork.completionContract.show') {
        if (options.serverHasShow === false) {
          throw Object.assign(new Error('unknown method'), { code: 'method_not_found' })
        }
        return showMethod().handler(
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the method declares a schema.
          (showMethod().params as { parse: (v: unknown) => unknown }).parse(params) as never,
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the method reads only the runtime.
          { runtime: serverRuntime } as never
        )
      }
      throw new Error(`unexpected call ${name}`)
    }
  } as unknown as OrcaRuntimeService
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these methods read only the runtime and the caller.
  const homeCtx = { runtime: homeRuntime, orchestrationCaller: undefined } as unknown as RpcContext

  const call = async (name: string, list: readonly unknown[], params: Record<string, unknown>) => {
    const found = method(list, name)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: every method here declares a schema.
    const parsed = (found.params as { parse: (v: unknown) => unknown }).parse(params)
    return found.handler(parsed as never, homeCtx) as Promise<unknown>
  }

  /** `orca orchestration task-create`, as its RPC method runs it at home. */
  const taskCreate = async (extra: Record<string, unknown>) =>
    (
      (await call('orchestration.taskCreate', ORCHESTRATION_MESSAGE_METHODS, {
        spec: 'do the work',
        run: run.id,
        callerTerminalHandle: COORDINATOR,
        ...extra
      })) as { task: { id: string } }
    ).task.id

  let requests = 0
  /** `orca orchestration worker-start --on build-server`, through the route the RPC dispatcher calls first. */
  const startOnHome = async (params: Record<string, unknown>) => {
    const start = method(ORCHESTRATION_WORKER_START_METHODS, 'orchestration.workerStart')
    requests += 1
    const values = WorkerStartParams.parse({
      run: run.id,
      from: COORDINATOR,
      on: 'build-server',
      agent: options.workerAgent ?? 'claude',
      worktree: 'new-top-level',
      ...params
    })
    const request = {
      id: `rpc-${requests}`,
      authToken: '',
      method: 'orchestration.workerStart',
      orchestrationRequestId: `req-${requests}`
    } as RpcRequest
    const routed = await routeRemoteOwnedCall(homeRuntime, start, request, values, homeCtx)
    if (!routed.handled) {
      throw new Error('the start did not go to the server')
    }
    return routed.result as { taskId: string; dispatchId: string }
  }

  const showAtHome = async (task: string) =>
    (await showMethod().handler(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the method declares a schema.
      (showMethod().params as { parse: (v: unknown) => unknown }).parse({ task }) as never,
      homeCtx
    )) as Parameters<typeof formatForkContract>[0]

  /** The worker's done, as the server's `orchestration.send` hands it to the gate. */
  const workerDone = (dispatchId: string) =>
    forkGateWorkerDone(
      serverRuntime,
      serverDb,
      {
        type: 'worker_done',
        subject: 'done',
        body: 'all finished',
        payload: JSON.stringify({ outcome: 'succeeded' })
      },
      dispatchId
    )
  return {
    folder,
    homeSettings: options.homeSettings,
    homeDb,
    serverDb,
    serverStarts,
    taskCreate,
    startOnHome,
    showAtHome,
    workerDone
  }
}

function writeMarker(folder: string): void {
  writeFileSync(join(folder, 'marker.txt'), 'here')
}

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
