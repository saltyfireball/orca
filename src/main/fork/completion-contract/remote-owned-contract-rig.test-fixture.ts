// The BAD-798 rig, shared by the tests of what travels with a start on a server that owns its
// workers (BAD-798, BAD-820, BAD-816). The home stores the Task through the real
// `orchestration.taskCreate` method and starts it through the real `--on` route, the real
// remote-owned start and the real placement tables; the server parses the start with the real
// params schema, creates its Dispatch with the real start step and gates the done with the real
// gate. Only the socket between the two runtimes and the server's terminal launch are replaced.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import type { formatForkContract } from '../../../cli/fork/completion-contract-handlers'
import { forkGateWorkerDone } from './completion-gate-live'
import { FORK_COMPLETION_CONTRACT_METHODS } from '../../runtime/rpc/methods/fork/fork-completion-contract'
import { ORCHESTRATION_MESSAGE_METHODS } from '../../runtime/rpc/methods/orchestration/messaging/message-methods'
import { ORCHESTRATION_WORKER_START_METHODS } from '../../runtime/rpc/methods/orchestration/worker/worker-start-method'
import { routeRemoteOwnedCall } from '../../runtime/orchestration/federation/remote-owned/remote-owned-route'
import { homeLinkConversation } from './remote-owned-relay.test-fixture'
import { createLocalWorkerStartDispatch } from '../../runtime/rpc/methods/orchestration/worker/start/local-worker-start-dispatch'

const dirs: string[] = []
/** Removes the rig's folders; each test file that builds a rig calls it from afterEach. */
export function removeRigFolders(): void {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

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

export type RigOptions = {
  serverCapabilities?: string[]
  serverHasShow?: boolean
  /** A git checkout (the reviewer needs a commit) instead of a project group's folder workspace. */
  git?: boolean
  workerAgent?: string
  /** The home's settings; the server keeps its own reviewer commands and has the all-Tasks setting off. */
  homeSettings?: Record<string, unknown>
  /** The server admits the start as a real peer Run, so its mail queues home (BAD-816). */
  peerRun?: boolean
}

export function rig(options: RigOptions = {}) {
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
    const peerRun = options.peerRun
      ? serverDb.getRun(
          serverDb.admitPeerRun({
            peerFingerprint: 'home-peer',
            peerRun: {
              runId: run.id,
              conversationId: homeLinkConversation(homeDb, run.id),
              label: 'home'
            }
          }).run_id
        )!
      : serverDb.createRun({
          objective: 'peer',
          coordinatorHandle: 'term_peer',
          coordinatorPaneKey: 'tab-p::33333333-3333-4333-8333-333333333333' as never
        })
    return dispatchOn(serverRuntime, serverDb, params, peerRun)
  }

  /** A start's ordinary dispatch creation on one host, bound to the folder workspace. */
  const dispatchOn = (
    hostRuntime: OrcaRuntimeService,
    hostDb: OrchestrationDb,
    params: ReturnType<typeof WorkerStartParams.parse>,
    hostRun: { id: string }
  ) => {
    const existingTask = params.task ? hostDb.getTask(params.task) : undefined
    const started = createLocalWorkerStartDispatch(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the start step reads only these members.
      {
        runtime: hostRuntime,
        db: hostDb,
        bindRun: () => hostRun,
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
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the start step reads only these members of its plan.
      {
        params,
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
    hostDb.db
      .prepare('UPDATE worker_dispatches SET worktree_id = ? WHERE dispatch_id = ?')
      .run('folder:ws_1', started.started.dispatch.id)
    return { dispatchId: started.started.dispatch.id, run: { id: hostRun.id }, state: 'ready' }
  }

  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the home's start reads only these members.
  const homeRuntime = {
    getOrchestrationDb: () => homeDb,
    resolveOrchestrationWorkerServer: async () => server,
    ensureOrchestrationFederationRelay: () => undefined,
    readMachineName: () => 'home',
    getRuntimeId: () => 'runtime_home',
    getNestedWorkerMaxDepth: () => 4,
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
  const workerDone = (dispatchId: string, extra: Record<string, unknown> = {}) =>
    forkGateWorkerDone(
      serverRuntime,
      serverDb,
      {
        type: 'worker_done',
        subject: 'done',
        body: 'all finished',
        payload: JSON.stringify({ outcome: 'succeeded' }),
        ...extra
      },
      dispatchId
    )
  /** `worker-start --task T` with no --on: the home's own start step and gate (BAD-816). */
  const startHere = (task: string) =>
    dispatchOn(
      homeRuntime,
      homeDb,
      WorkerStartParams.parse({
        run: run.id,
        from: COORDINATOR,
        agent: 'claude',
        worktree: 'new-top-level',
        task
      }),
      run
    )
  const workerDoneHere = (dispatchId: string, extra: Record<string, unknown> = {}) =>
    forkGateWorkerDone(
      homeRuntime,
      homeDb,
      { type: 'worker_done', subject: 'done', body: 'all finished', ...extra },
      dispatchId
    )

  return {
    folder,
    run,
    startHere,
    workerDoneHere,
    server,
    homeCtx,
    call,
    homeSettings: options.homeSettings,
    homeDb,
    serverDb,
    serverRuntime,
    serverStarts,
    taskCreate,
    startOnHome,
    showAtHome,
    workerDone
  }
}

export function writeMarker(folder: string): void {
  writeFileSync(join(folder, 'marker.txt'), 'here')
}
