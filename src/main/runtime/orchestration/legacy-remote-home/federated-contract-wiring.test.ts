// BAD-763: the two hook lines that carry a Task's contract to a paired server, driven for real: the
// home's startFederatedWorker sends the fields, and the server's own attach handler stores them.
import { describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../db/orchestration-db'
import '../db/contract-constants'
import '../db/messages/mailbox-routing-page'
import '../db/dispatch-row-writer'
import '../db/attempt-outcome-projection'
import { createRootDispatch } from '../db/root-dispatch-test-fixture'
import {
  ORCHESTRATION_CONTRACT_RUNTIME_CAPABILITY,
  ORCHESTRATION_FEDERATION_RUNTIME_CAPABILITY,
  ORCHESTRATION_FORK_CONTRACT_CARRY_RUNTIME_CAPABILITY
} from '../../../../shared/orchestration/orchestration-runtime-capabilities'
import { ORCHESTRATION_FEDERATION_ATTACH_METHODS } from '../legacy-remote/federation'
import { startFederatedWorker } from './federated-worker-start'
import { forkTaskContractWire } from '../../../fork/completion-contract/contract-carry'
import { readContract, saveContract } from '../../../fork/completion-contract/contract-store'
import { readReviewGate, saveReviewGate } from '../../../fork/reviewer-gate/reviewer-store'
import type { OrcaRuntimeService } from '../../orca-runtime'

const BASE_CAPS = [
  ORCHESTRATION_CONTRACT_RUNTIME_CAPABILITY,
  ORCHESTRATION_FEDERATION_RUNTIME_CAPABILITY
]

function home(capabilities: string[]) {
  const db = new OrchestrationDb(':memory:')
  const run = db.createRun({
    objective: 'carry',
    coordinatorHandle: 'term_coordinator',
    coordinatorPaneKey: 'tab-c::22222222-2222-4222-8222-222222222222' as never
  })
  const attachStarts: Record<string, unknown>[] = []
  const calls: string[] = []
  const runtime = {
    getOrchestrationDb: () => db,
    resolveOrchestrationWorkerServer: async () => ({
      environmentId: 'env_1',
      name: 'build-server',
      peerFingerprint: 'fp_server',
      pairingRevision: 1
    }),
    callOrchestrationWorkerServer: vi.fn(async (_env: string, method: string, params: unknown) => {
      calls.push(method)
      if (method === 'status.get') {
        return { capabilities }
      }
      attachStarts.push(params as Record<string, unknown>)
      const sent = params as { dispatchId: string }
      return {
        dispatchId: sent.dispatchId,
        state: 'ready',
        runtimeEpoch: 'epoch_1',
        worktreeId: 'wt_remote',
        terminalHandle: 'term_remote'
      }
    }),
    getNestedWorkerMaxDepth: () => 4,
    getRuntimeId: () => 'runtime_home',
    ensureOrchestrationFederationRelay: () => undefined,
    getTerminalOrchestrationCliCommand: () => 'orca',
    notifyMessageArrived: () => undefined,
    getTerminalPaneKey: () => 'tab-c::22222222-2222-4222-8222-222222222222',
    getTerminalProcessIncarnation: () => 'pid-c'
  } as unknown as OrcaRuntimeService
  const start = (
    extra: Record<string, unknown>,
    task?: { id: string; spec: string; status: string }
  ) =>
    startFederatedWorker({
      params: {
        from: 'term_coordinator',
        on: 'build-server',
        worktree: 'id:wt_remote',
        agent: 'claude',
        spec: 'do the work',
        timeoutMs: 60_000,
        ...extra
      } as never,
      runtime,
      db,
      bindRunId: () => run.id,
      task,
      taskDeps: undefined,
      orchestrationMutation: {
        callerFingerprint: 'fp_home',
        requestId: `req_${attachStarts.length}`,
        method: 'orchestration.workerStart',
        payloadHash: 'hash'
      } as never
    })
  const rows = () =>
    ['tasks', 'dispatch_contexts', 'worker_dispatches', 'federated_dispatches'].map(
      (table) => (db.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
    )
  return { db, run, start, attachStarts, calls, rows }
}

/** The server: its own database, and the real attach handler. */
async function attachOnServer(sent: Record<string, unknown>) {
  const serverDb = new OrchestrationDb(':memory:')
  const runtime = {
    getOrchestrationDb: () => serverDb,
    getRuntimeId: () => 'runtime_server',
    validateOrchestrationAgentLauncher: () => undefined,
    showManagedTerminalWorkspace: async () => {
      throw new Error('the workspace is not part of this test')
    }
  } as unknown as OrcaRuntimeService
  const handler = ORCHESTRATION_FEDERATION_ATTACH_METHODS[0]!.handler as (
    params: unknown,
    context: unknown
  ) => Promise<unknown>
  await handler(sent, {
    runtime,
    orchestrationMutation: {
      callerFingerprint: 'fp_home',
      requestId: 'req_attach',
      method: 'orchestration.federationAttachStart',
      payloadHash: 'hash_attach'
    }
  }).catch(() => undefined)
  return serverDb
}

describe('a start on a paired server carries the contract', () => {
  it('sends the done checks and review the start declared, and the server stores them', async () => {
    const h = home([...BASE_CAPS, ORCHESTRATION_FORK_CONTRACT_CARRY_RUNTIME_CAPABILITY])
    await h.start({
      forkDoneChecks: ['pnpm test'],
      forkDoneMaxRounds: 3,
      forkReview: true,
      forkReviewFocus: 'security'
    })
    expect(h.attachStarts).toHaveLength(1)
    expect(h.attachStarts[0]).toMatchObject({
      forkDoneChecks: ['pnpm test'],
      forkDoneMaxRounds: 3,
      forkReview: true,
      forkReviewFocus: 'security'
    })

    const server = await attachOnServer(h.attachStarts[0]!)
    const taskId = h.attachStarts[0]!.taskId as string
    expect(readContract(server, taskId)?.contract).toMatchObject({
      checks: ['pnpm test'],
      maxRounds: 3
    })
    expect(readReviewGate(server, taskId)?.gate).toMatchObject({ focus: 'security' })
    // The home keeps its own copy for `orca contract show`.
    expect(readContract(h.db, taskId)?.contract.checks).toEqual(['pnpm test'])
  })

  it('sends what task-create stored on the Task', async () => {
    const h = home([...BASE_CAPS, ORCHESTRATION_FORK_CONTRACT_CARRY_RUNTIME_CAPABILITY])
    const task = h.db.createTask({ spec: 'do the work', runId: h.run.id })
    saveContract(h.db, task.id, { checks: ['make check'], requirePrChecks: true, maxRounds: null })
    await h.start({ task: task.id }, task)
    expect(h.attachStarts[0]).toMatchObject({
      forkDoneChecks: ['make check'],
      forkRequirePrChecks: true
    })
    const server = await attachOnServer(h.attachStarts[0]!)
    expect(readContract(server, task.id)?.contract.requirePrChecks).toBe(true)
  })

  it('sends nothing extra for a Task with no contract', async () => {
    const h = home([...BASE_CAPS, ORCHESTRATION_FORK_CONTRACT_CARRY_RUNTIME_CAPABILITY])
    await h.start({})
    expect(Object.keys(h.attachStarts[0]!).filter((key) => key.startsWith('fork'))).toEqual([])
    const server = await attachOnServer(h.attachStarts[0]!)
    expect(forkTaskContractWire(server, h.attachStarts[0]!.taskId as string)).toBeNull()
  })
})

describe('a server without orchestration.fork-contract-carry.v1', () => {
  async function refused(h: ReturnType<typeof home>, extra: Record<string, unknown>, task?: never) {
    const before = h.rows()
    await expect(h.start(extra, task)).rejects.toMatchObject({
      code: 'capability_unsupported',
      message: expect.stringContaining('No effects were applied')
    })
    // Nothing was created: no Task, Dispatch, worker or federation row, and no attach call.
    expect(h.rows()).toEqual(before)
    expect(h.calls).not.toContain('orchestration.federationAttachStart')
  }

  it('refuses a start whose contract is declared', async () => {
    await refused(home(BASE_CAPS), { forkDoneChecks: ['pnpm test'] })
  })

  it('refuses a start whose review is declared', async () => {
    await refused(home(BASE_CAPS), { forkReview: true })
  })

  it('refuses a start whose Task has a stored contract', async () => {
    const h = home(BASE_CAPS)
    const task = h.db.createTask({ spec: 'do the work', runId: h.run.id })
    saveContract(h.db, task.id, { checks: ['x'], requirePrChecks: false, maxRounds: null })
    await refused(h, { task: task.id }, task as never)
  })

  it('refuses a start whose stored review is on the Task', async () => {
    const h = home(BASE_CAPS)
    const task = h.db.createTask({ spec: 'do the work', runId: h.run.id })
    saveReviewGate(h.db, task.id, { focus: 'correctness', agent: null, maxRounds: null })
    await refused(h, { task: task.id }, task as never)
  })

  it('refuses a retry that would inherit a contract', async () => {
    const h = home(BASE_CAPS)
    const first = h.db.createTask({ spec: 'first', runId: h.run.id })
    const dispatch = createRootDispatch(h.db, first.id, 'term_worker')
    saveContract(h.db, first.id, { checks: ['x'], requirePrChecks: false, maxRounds: null })
    await refused(h, { retryOf: dispatch.id })
  })

  it('still starts a Task with nothing to carry', async () => {
    const h = home(BASE_CAPS)
    await h.start({})
    expect(h.calls).toContain('orchestration.federationAttachStart')
  })
})
