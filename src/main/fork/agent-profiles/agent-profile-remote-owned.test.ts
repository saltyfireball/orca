// BAD-741 proof for the remote-owned hook: `worker-start --profile --on` a server that owns its
// workers sends the home's resolution in the start, and an older server is refused first.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import {
  ORCHESTRATION_FORK_AGENT_PROFILE_LAUNCH_RUNTIME_CAPABILITY,
  ORCHESTRATION_RUNTIME_CAPABILITIES
} from '../../../shared/orchestration/orchestration-runtime-capabilities'
import { withForkMcpLaunchScope } from '../mcp-profiles/mcp-launch-scope'
import { installForkAgentProfileLaunch } from './agent-profile-launch-scope'

const sent: unknown[] = []
const placed = vi.fn()
vi.mock('../../runtime/rpc/methods/orchestration/worker/worker-start-method', () => ({
  prepareWorkerStart: async () => ({
    coordinator: null,
    bindRun: () => ({ run: { id: 'run_1', consumer_generation: 1 }, created: false }),
    helperCreator: undefined,
    taskDeps: undefined,
    existingTask: undefined,
    withRun: (receipt: unknown) => receipt
  })
}))
vi.mock('../../runtime/orchestration/db/remote-owned/remote-run-links', () => ({
  openRemoteRunLink: () => {
    placed()
    return { conversation_id: 'conv_1' }
  }
}))
vi.mock('../../runtime/orchestration/db/remote-owned/remote-placements', () => ({
  reserveRemotePlacement: () => ({ task: { id: 'task_1', spec: 'work' }, nothingSent: true }),
  recordRemoteStart: () => true,
  releaseRemotePlacement: () => undefined
}))
vi.mock('../../runtime/orchestration/db/remote-owned/remote-placement-hold', () => ({
  refuseTaskOfClosedPairing: () => undefined,
  markRemotePlacementNeverSent: () => undefined
}))
vi.mock(
  '../../runtime/orchestration/federation/remote-owned/remote-owned-calls',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    callRemoteOwnedServer: async (_runtime: unknown, _link: unknown, call: { params: unknown }) => {
      sent.push(call.params)
      return { dispatchId: 'ctx_1', state: 'ready' }
    }
  })
)
const { startRemoteOwnedWorker } =
  await import('../../runtime/orchestration/federation/remote-owned/remote-owned-start')

const server = {
  environmentId: 'env-1',
  name: 'server-a',
  peerFingerprint: 'peer-1',
  pairingRevision: 1
}

function runtimeWith(capabilities: string[]) {
  const db = new OrchestrationDb(':memory:')
  return {
    getOrchestrationDb: () => db,
    getTerminalPaneKey: () => 'tab-c::22222222-2222-4222-8222-222222222222',
    resolveOrchestrationWorkerServer: async () => server,
    ensureOrchestrationFederationRelay: () => undefined,
    notifyMessageArrived: () => undefined,
    bots: { list: () => [] },
    callOrchestrationWorkerServer: async () => ({
      runtimeId: `rt-${capabilities.length}`,
      capabilities
    })
  }
}

const params = {
  spec: 'work',
  on: 'server-a',
  from: 'term_c',
  agent: 'claude',
  worktree: 'new-top-level',
  forkAgentProfile: 'reviewer'
}

function start(runtime: ReturnType<typeof runtimeWith>) {
  const ctx = {
    runtime,
    orchestrationCaller: undefined,
    orchestrationCompatibilityEvidence: undefined
  }
  return withForkMcpLaunchScope({ request: { method: 'orchestration.workerStart', params } }, () =>
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: partial runtime, params and context: the start's other steps are mocked.
    startRemoteOwnedWorker(runtime as never, params as never, ctx as never, 'req-1')
  )
}

beforeEach(() => {
  sent.length = 0
  placed.mockClear()
  installForkAgentProfileLaunch({
    readSettings: () => ({
      forkAgentProfiles: [
        { name: 'reviewer', agent: 'claude', permissionMode: 'ask', account: 'dev@example.com' }
      ]
    }),
    claudeRouter: () => undefined
  })
})

describe('worker-start --profile --on a server that owns its workers', () => {
  it('sends the profile resolution the home made', async () => {
    await start(runtimeWith([ORCHESTRATION_FORK_AGENT_PROFILE_LAUNCH_RUNTIME_CAPABILITY]))
    expect(sent[0]).toMatchObject({
      forkAgentProfileLaunch: {
        name: 'reviewer',
        agent: 'claude',
        permissionMode: 'ask',
        account: 'dev@example.com'
      }
    })
  })

  it('refuses a server that cannot apply it before any link is written', async () => {
    await expect(start(runtimeWith(['orchestration.remote-owned-workers.v1']))).rejects.toThrow(
      /cannot apply profile "reviewer"/
    )
    expect(placed).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })

  it('this build advertises that it applies a carried profile', () => {
    expect(ORCHESTRATION_RUNTIME_CAPABILITIES).toContain(
      ORCHESTRATION_FORK_AGENT_PROFILE_LAUNCH_RUNTIME_CAPABILITY
    )
  })
})
