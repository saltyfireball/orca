// BAD-816: a worker's own `orca orchestration send --type worker_done` after its last allowed round.
// The CLI's real send handler (its flags, its mutation request, its post-verification read) talks to
// a real runtime through the real RPC dispatcher and every method it registers; the Task's result
// schema is stored the way task-create stores it. Rounds 1 and 2 are turned back; on round 3 the
// done is escalated and the Task stays open, and the worker must be told that, finally, instead of
// an operation_unknown that sends it back with --retry-request.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestStores, createStore, testState } from '../../persistence/persistence-test-harness'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { createRootDispatch } from '../../runtime/orchestration/db/root-dispatch-test-fixture'
import { RpcDispatcher } from '../../runtime/rpc/dispatcher'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../shared/orchestration/orchestration-runtime-capabilities'
import { ALL_RPC_METHODS } from '../../runtime/rpc/methods/rpc-method-registry'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { RuntimeClientError } from '../../../cli/runtime/connection/types'
import { ORCHESTRATION_HANDLERS } from '../../../cli/orchestration/orchestration-handlers'
import { forkStoreDoneContract } from './completion-gate-live'
import { readContract } from './contract-store'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../telemetry/client', () => ({ track: vi.fn() }))

const SCHEMA = JSON.stringify({
  type: 'object',
  properties: { verdict: { enum: ['pass', 'fail'] } },
  required: ['verdict'],
  additionalProperties: false
})

const IDENTITY_ENV = ['ORCA_TERMINAL_HANDLE', 'ORCA_PANE_KEY', 'ORCA_AGENT_SESSION_ID']
const saved = new Map(IDENTITY_ENV.map((name) => [name, process.env[name]]))
let work = ''

beforeEach(() => {
  testState.dir = mkdtempSync(join(tmpdir(), 'done-escalated-data-'))
  work = mkdtempSync(join(tmpdir(), 'done-escalated-work-'))
  for (const name of IDENTITY_ENV) {
    delete process.env[name]
  }
})

afterEach(async () => {
  for (const [name, value] of saved) {
    if (value === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = value
    }
  }
  await closeTestStores()
  rmSync(testState.dir, { recursive: true, force: true })
  rmSync(work, { recursive: true, force: true })
})

type Setup = {
  db: OrchestrationDb
  taskId: string
  dispatchId: string
  runtime: OrcaRuntimeService
}

async function setup(peer: boolean): Promise<Setup> {
  const { OrcaRuntimeService } = await import('../../runtime/orca-runtime')
  const runtime = new OrcaRuntimeService(createStore() as never)
  const db = new OrchestrationDb(':memory:')
  runtime.setOrchestrationDb(db)
  // On a paired start the worker's Run is the home's, admitted on the server that runs it.
  const runId = peer
    ? db.admitPeerRun({
        peerFingerprint: 'fp_home',
        peerRun: { runId: 'run_home', conversationId: 'conv_home', label: 'home' }
      }).run_id
    : db.createRun({ objective: 'o', coordinatorHandle: 'term_coord', coordinatorPaneKey: null }).id
  const taskId = db.createTask({ runId, spec: 'work' }).id
  forkStoreDoneContract(db, taskId, { forkResultSchema: SCHEMA })
  const dispatchId = createRootDispatch(db, taskId, 'term_worker').id
  return { db, taskId, dispatchId, runtime }
}

/** The worker's command, through the CLI handler; resolves to its error (or null on success). */
async function workerDone(
  s: Setup,
  value: string,
  retryRequest?: string
): Promise<{ error: RuntimeClientError | null; requestId: string | undefined }> {
  const dispatcher = new RpcDispatcher({ runtime: s.runtime, methods: ALL_RPC_METHODS })
  let requestId: string | undefined
  const client = {
    call: async (
      method: string,
      params: unknown,
      options?: { orchestrationRequestId?: string }
    ) => {
      if (method === 'orchestration.send') {
        requestId = options?.orchestrationRequestId
      }
      const reply = await dispatcher.dispatch({
        id: `rpc-${method}`,
        authToken: 'tok',
        method,
        params,
        orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
        ...(options?.orchestrationRequestId
          ? { orchestrationRequestId: options.orchestrationRequestId }
          : {})
      } as never)
      if (!reply.ok) {
        throw new RuntimeClientError(reply.error.code, reply.error.message, reply.error.data)
      }
      return reply
    }
  }
  writeFileSync(join(work, 'result.json'), value)
  const flags = new Map<string, string | boolean>(
    Object.entries({
      from: 'term_worker',
      type: 'worker_done',
      subject: 'done',
      body: 'finished',
      'task-id': s.taskId,
      'dispatch-id': s.dispatchId,
      outcome: 'succeeded',
      'result-file': 'result.json',
      ...(retryRequest ? { 'retry-request': retryRequest } : {})
    })
  )
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  try {
    await ORCHESTRATION_HANDLERS['orchestration send']!({
      flags,
      client,
      cwd: work,
      json: true
    } as never)
    return { error: null, requestId }
  } catch (error) {
    return { error: error as RuntimeClientError, requestId }
  } finally {
    log.mockRestore()
  }
}

describe.each([
  ['a worker on this computer', false],
  ['a worker of a paired start, on the server that runs it', true]
])('worker_done with an invalid result after the last allowed round, %s', (_label, peer) => {
  it('is told its report went to the coordinator and the Task stays open, the same again on --retry-request', async () => {
    const s = await setup(peer)
    for (const round of [1, 2]) {
      const turnedBack = await workerDone(s, '{"verdict":"maybe"}')
      expect(turnedBack.error?.code, `round ${round}`).toBe('done_checks_failed')
    }
    const last = await workerDone(s, '{"verdict":"maybe"}')
    expect(readContract(s.db, s.taskId)?.escalated).toBe(true)
    expect(s.db.getTask(s.taskId)?.status).not.toBe('completed')
    expect(last.error?.code).toBe('worker_done_escalated')
    expect(last.error?.message).toContain('sent your report to the coordinator as an escalation')
    expect(last.error?.message).toContain('the Task stays open')
    expect(last.error?.message).toContain('Do not send worker_done again')

    const again = await workerDone(s, '{"verdict":"maybe"}', last.requestId)
    expect(again.error?.code).toBe('worker_done_escalated')
    // The retry replayed the same mutation: still one escalation for the coordinator.
    const escalations = s.db.db
      .prepare(`SELECT COUNT(*) AS n FROM messages WHERE type = 'escalation'`)
      .get() as { n: number }
    expect(escalations.n).toBe(1)
  })
})
