// BAD-763: `worker-start --on <server> --done-check ...` on a server that owns its workers. The
// home's real remote-owned start, the real placement tables, the server's real dispatch creation
// and gate, and the real `fork.completionContract.show` method on both sides; only the socket
// between the two orchestration databases is replaced by a function call.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import '../../runtime/orchestration/db/contract-constants'
import '../../runtime/orchestration/db/messages/mailbox-routing-page'
import '../../runtime/orchestration/db/dispatch-row-writer'
import '../../runtime/orchestration/db/attempt-outcome-projection'
import {
  ORCHESTRATION_FORK_CONTRACT_CARRY_RUNTIME_CAPABILITY,
  ORCHESTRATION_REMOTE_OWNED_WORKERS_RUNTIME_CAPABILITY
} from '../../../shared/orchestration/orchestration-runtime-capabilities'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { formatForkContract } from '../../../cli/fork/completion-contract-handlers'
import { forkGateWorkerDone } from './completion-gate-live'
import { FORK_COMPLETION_CONTRACT_METHODS } from '../../runtime/rpc/methods/fork/fork-completion-contract'

const homeRun: { db: OrchestrationDb | null; runId: string } = { db: null, runId: '' }

// The caller and Run binding a CLI start resolves are the only part of the start left out.
vi.mock('../../runtime/rpc/methods/orchestration/worker/worker-start-method', async () => ({
  ...(await vi.importActual<object>(
    '../../runtime/rpc/methods/orchestration/worker/worker-start-method'
  )),
  prepareWorkerStart: async () => ({
    coordinator: null,
    bindRun: () => ({ run: homeRun.db!.getRun(homeRun.runId), created: false }),
    helperCreator: undefined,
    taskDeps: undefined,
    existingTask: undefined,
    withRun: (receipt: unknown) => receipt
  })
}))
const { startRemoteOwnedWorker } =
  await import('../../runtime/orchestration/federation/remote-owned/remote-owned-start')
const { createLocalWorkerStartDispatch } =
  await import('../../runtime/rpc/methods/orchestration/worker/start/local-worker-start-dispatch')

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const server = {
  environmentId: 'env-1',
  name: 'build-server',
  peerFingerprint: 'peer-1',
  pairingRevision: 1
}

function showMethod() {
  const found = FORK_COMPLETION_CONTRACT_METHODS.find(
    (entry) => entry.name === 'fork.completionContract.show'
  )
  if (!found) {
    throw new Error('no fork.completionContract.show')
  }
  return found
}

type Rig = ReturnType<typeof rig>

function rig(options: { serverCapabilities: string[]; serverHasShow?: boolean } | undefined) {
  const folder = mkdtempSync(join(tmpdir(), 'remote-owned-contract-'))
  dirs.push(folder)
  const homeDb = new OrchestrationDb(':memory:')
  const run = homeDb.createRun({
    objective: 'carry',
    coordinatorHandle: 'term_coordinator',
    coordinatorPaneKey: 'tab-c::22222222-2222-4222-8222-222222222222' as never
  })
  homeRun.db = homeDb
  homeRun.runId = run.id
  const serverDb = new OrchestrationDb(':memory:')
  const capabilities = options?.serverCapabilities ?? [
    ORCHESTRATION_REMOTE_OWNED_WORKERS_RUNTIME_CAPABILITY,
    ORCHESTRATION_FORK_CONTRACT_CARRY_RUNTIME_CAPABILITY
  ]
  const serverRuntime = {
    getOrchestrationDb: () => serverDb,
    getRuntimeId: () => 'runtime_server',
    getNestedWorkerMaxDepth: () => 4,
    requireStore: () => ({
      getSettings: () => ({}),
      getRepo: () => ({ id: 'repo_1', kind: 'folder', path: folder }),
      getRepos: () => [],
      getProjectGroups: () => []
    }),
    resolveRuntimeFileTarget: async () => ({
      worktree: { repoId: 'repo_1', path: folder, git: { branch: '' } },
      executionHostId: 'local'
    })
  } as unknown as OrcaRuntimeService

  /** The server's side of `orchestration.workerStart`: its ordinary dispatch creation for the Task. */
  const startOnServer = (params: Record<string, unknown>) => {
    const peerRun = serverDb.createRun({
      objective: 'peer',
      coordinatorHandle: 'term_peer',
      coordinatorPaneKey: 'tab-p::33333333-3333-4333-8333-333333333333' as never
    })
    const started = createLocalWorkerStartDispatch(
      {
        runtime: serverRuntime,
        db: serverDb,
        taskDeps: undefined,
        coordinator: null,
        callerSession: undefined,
        existingTask: undefined,
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
        resolvedWorktreeId: 'wt_folder',
        repoSelector: undefined,
        agent: 'claude',
        launchReceipt: {}
      } as never
    )
    // The launch step binds the worker to its workspace; the checks run there.
    serverDb.db
      .prepare('UPDATE worker_dispatches SET worktree_id = ? WHERE dispatch_id = ?')
      .run('wt_folder', started.dispatch.id)
    return { dispatchId: started.dispatch.id, run: { id: peerRun.id }, state: 'ready' }
  }

  const sent: { method: string; params: Record<string, unknown> }[] = []
  const homeRuntime = {
    getOrchestrationDb: () => homeDb,
    resolveOrchestrationWorkerServer: async () => server,
    ensureOrchestrationFederationRelay: () => undefined,
    notifyMessageArrived: () => undefined,
    readMachineName: () => 'home',
    getRuntimeId: () => 'runtime_home',
    bots: { list: () => [] },
    callOrchestrationWorkerServer: async (_env: string, method: string, params: unknown) => {
      if (method === 'status.get') {
        return { runtimeId: 'runtime_server', capabilities }
      }
      if (method === 'orchestration.workerStart') {
        sent.push({ method, params: params as Record<string, unknown> })
        return startOnServer(params as Record<string, unknown>)
      }
      if (method === 'fork.completionContract.show') {
        if (options?.serverHasShow === false) {
          throw Object.assign(new Error('unknown method'), { code: 'method_not_found' })
        }
        return showMethod().handler(
          showMethod().params.parse(params),
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the method reads only the runtime.
          { runtime: serverRuntime } as never
        )
      }
      throw new Error(`unexpected call ${method}`)
    }
  } as unknown as OrcaRuntimeService

  const startOnHome = (extra: Record<string, unknown> = {}) =>
    startRemoteOwnedWorker(
      homeRuntime,
      {
        spec: 'do the work',
        on: 'build-server',
        agent: 'claude',
        worktree: 'new-top-level',
        forkDoneChecks: ['test -f marker.txt'],
        ...extra
      } as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the start reads only these members.
      { runtime: homeRuntime, orchestrationCaller: undefined } as never,
      'req-1'
    ) as Promise<{ taskId: string; dispatchId: string }>

  const showAtHome = async (task: string) =>
    showMethod().handler(
      showMethod().params.parse({ task }),
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the method reads only the runtime.
      { runtime: homeRuntime } as never
    )

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
  return { folder, homeDb, serverDb, sent, startOnHome, showAtHome, workerDone }
}

describe('worker-start --done-check on a server that owns its workers', () => {
  it('shows at home the declared check, each attempt and its output tail, live and after it settles', async () => {
    const r: Rig = rig(undefined)
    const started = await r.startOnHome()

    // Live: the check is declared and the start is placed there; nothing has run yet.
    const live = await r.showAtHome(started.taskId)
    expect(live).toMatchObject({ declared: true, checks: ['test -f marker.txt'] })
    expect(live.servers).toEqual([{ name: 'build-server', attempts: 0 }])
    expect(formatForkContract(live)).toContain('check: test -f marker.txt')

    // The check fails once (nothing is turned in without the marker file), then passes.
    const first = await r.workerDone(started.dispatchId)
    expect(first).toMatchObject({ kind: 'answer' })
    writeMarker(r.folder)
    const second = await r.workerDone(started.dispatchId)
    expect(second).toMatchObject({ kind: 'carry-on' })

    const settled = await r.showAtHome(started.taskId)
    expect(settled.declared).toBe(true)
    expect(settled.attempts.map((attempt) => attempt.outcome)).toEqual(['fail', 'pass'])
    expect(settled.attempts[0]!.results[0]).toMatchObject({ ok: false, exitCode: 1 })
    expect(settled.servers).toEqual([{ name: 'build-server', attempts: 2 }])
    const text = formatForkContract(settled)
    expect(text).toContain('check: test -f marker.txt')
    expect(text).toContain('server build-server: 2 check attempt(s) ran there')
    expect(text).not.toContain('declares no done checks')
  })

  it('names a server too old to show its evidence rather than saying no checks were declared', async () => {
    const r: Rig = rig({
      serverCapabilities: [ORCHESTRATION_REMOTE_OWNED_WORKERS_RUNTIME_CAPABILITY],
      serverHasShow: false
    })
    const started = await r.startOnHome()
    // A Task the home never stored a contract for (started before this build).
    r.homeDb.db.prepare('DELETE FROM fork_done_contracts').run()

    const shown = await r.showAtHome(started.taskId)

    expect(shown.declared).toBe(false)
    expect(shown.servers?.[0]).toMatchObject({ name: 'build-server', attempts: 0 })
    const text = formatForkContract(shown)
    expect(text).toContain('server build-server: cannot see its check evidence')
    expect(text).not.toContain('declares no done checks')
  })

  it('stores nothing when the start declared no checks', async () => {
    const r: Rig = rig(undefined)
    const started = await r.startOnHome({ forkDoneChecks: undefined })

    const shown = await r.showAtHome(started.taskId)

    expect(shown.declared).toBe(false)
  })
})

function writeMarker(folder: string): void {
  writeFileSync(join(folder, 'marker.txt'), 'here')
}
