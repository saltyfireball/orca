// Pause all over the legacy attach path (BAD-818): a home's real startFederatedWorker builds the
// attach request, and the server's real `orchestration.federationAttachStart` handler takes it with
// the real switch in a temporary data folder. While paused (or with an unreadable switch) a start
// that would launch a terminal agent is refused with the pause reason before the attachment is
// written; when not paused it goes on to place the worker.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const paths = vi.hoisted(() => ({ userData: '' }))
vi.mock('../../../shared/app-lifecycle/app-environment', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  getAppEnvironment: () => ({ getPath: () => paths.userData }),
  hasAppEnvironment: () => true
}))

import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import '../../runtime/orchestration/db/contract-constants'
import '../../runtime/orchestration/db/messages/mailbox-routing-page'
import '../../runtime/orchestration/db/dispatch-row-writer'
import '../../runtime/orchestration/db/attempt-outcome-projection'
import {
  ORCHESTRATION_CONTRACT_RUNTIME_CAPABILITY,
  ORCHESTRATION_FEDERATION_RUNTIME_CAPABILITY
} from '../../../shared/orchestration/orchestration-runtime-capabilities'
import { ORCHESTRATION_FEDERATION_ATTACH_METHODS } from '../../runtime/orchestration/legacy-remote/federation'
import { startFederatedWorker } from '../../runtime/orchestration/legacy-remote-home/federated-worker-start'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { PAUSE_ALL_WORKER_START_CODE } from './pause-all-terminal-worker-start'
import {
  PAUSE_ALL_STATE_FILE_NAME,
  resetForkPauseAllCacheForTests,
  writeForkPauseAll
} from './pause-all-state'

beforeEach(() => {
  paths.userData = mkdtempSync(join(tmpdir(), 'pause-all-attach-'))
  resetForkPauseAllCacheForTests()
})
afterEach(() => {
  rmSync(paths.userData, { recursive: true, force: true })
})

/** The attach request a home sends for a start in an existing server workspace. */
async function attachRequest(): Promise<Record<string, unknown>> {
  const db = new OrchestrationDb(':memory:')
  const run = db.createRun({
    objective: 'carry',
    coordinatorHandle: 'term_coordinator',
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a pane key in the shape the run stores.
    coordinatorPaneKey: 'tab-c::22222222-2222-4222-8222-222222222222' as never
  })
  const sent: Record<string, unknown>[] = []
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the home start reads only these.
  const runtime = {
    getOrchestrationDb: () => db,
    // Upstream's worker-start checks the agent is installed before any launch.
    detectProjectLaunchContext: async () => ({ agents: ['claude', 'codex'] }),
    resolveOrchestrationWorkerServer: async () => ({
      environmentId: 'env_1',
      name: 'build-server',
      peerFingerprint: 'fp_server',
      pairingRevision: 1
    }),
    callOrchestrationWorkerServer: async (_env: string, method: string, params: unknown) => {
      if (method === 'status.get') {
        return {
          capabilities: [
            ORCHESTRATION_CONTRACT_RUNTIME_CAPABILITY,
            ORCHESTRATION_FEDERATION_RUNTIME_CAPABILITY
          ]
        }
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the federation request params are a plain object.
      sent.push(params as Record<string, unknown>)
      throw new Error('the server answers in the test below')
    },
    getNestedWorkerMaxDepth: () => 4,
    getRuntimeId: () => 'runtime_home',
    ensureOrchestrationFederationRelay: () => undefined,
    getTerminalOrchestrationCliCommand: () => 'orca',
    notifyMessageArrived: () => undefined,
    getTerminalPaneKey: () => 'tab-c::22222222-2222-4222-8222-222222222222',
    getTerminalProcessIncarnation: () => 'pid-c'
  } as unknown as OrcaRuntimeService
  await startFederatedWorker({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the start reads only these fields of the worker-start params.
    params: {
      from: 'term_coordinator',
      on: 'build-server',
      worktree: 'id:wt_remote',
      agent: 'claude',
      spec: 'do the work',
      timeoutMs: 60_000
    } as never,
    runtime,
    db,
    bindRunId: () => run.id,
    task: undefined,
    taskDeps: undefined,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the receipt bookkeeping reads only these fields.
    orchestrationMutation: {
      callerFingerprint: 'fp_home',
      requestId: 'req_0',
      method: 'orchestration.workerStart',
      payloadHash: 'hash'
    } as never
  }).catch(() => undefined)
  expect(sent).toHaveLength(1)
  return sent[0]!
}

async function attachOnServer(sent: Record<string, unknown>) {
  const serverDb = new OrchestrationDb(':memory:')
  const placed = vi.fn(async () => {
    throw new Error('placing the worker is not part of this test')
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the attach handler reads only these before placement.
  const runtime = {
    getOrchestrationDb: () => serverDb,
    // Upstream's worker-start checks the agent is installed before any launch.
    detectProjectLaunchContext: async () => ({ agents: ['claude', 'codex'] }),
    getRuntimeId: () => 'runtime_server',
    validateOrchestrationAgentLauncher: () => undefined,
    showManagedTerminalWorkspace: placed
  } as unknown as OrcaRuntimeService
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the registered handler takes params and a context like every RPC handler.
  const handler = ORCHESTRATION_FEDERATION_ATTACH_METHODS[0]!.handler as (
    params: unknown,
    context: unknown
  ) => Promise<unknown>
  const outcome = await handler(sent, {
    runtime,
    orchestrationMutation: {
      callerFingerprint: 'fp_home',
      requestId: 'req_attach',
      method: 'orchestration.federationAttachStart',
      payloadHash: 'hash_attach'
    }
  }).then(
    () => null,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: RPC errors carry a code and a message.
    (error: unknown) => error as { code?: string; message?: string }
  )
  const receipts =
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: COUNT(*) returns one row with n.
    (serverDb.db.prepare('SELECT COUNT(*) AS n FROM mutation_receipts').get() as { n: number }).n
  return { outcome, receipts, placed }
}

describe('pause all over the legacy attach path', () => {
  it('refuses a start that would launch a terminal agent, before the attachment is written', async () => {
    const sent = await attachRequest()
    writeForkPauseAll(true, { by: 'cli' })
    const paused = await attachOnServer(sent)
    expect(paused.outcome?.code).toBe(PAUSE_ALL_WORKER_START_CODE)
    expect(paused.outcome?.message).toContain('Paused by pause-all')
    expect(paused.receipts).toBe(0)
    expect(paused.placed).not.toHaveBeenCalled()
  })

  it('refuses with an unreadable switch, and goes on to place the worker when not paused', async () => {
    const sent = await attachRequest()
    writeFileSync(join(paths.userData, PAUSE_ALL_STATE_FILE_NAME), 'nope')
    expect((await attachOnServer(sent)).outcome?.code).toBe(PAUSE_ALL_WORKER_START_CODE)

    rmSync(join(paths.userData, PAUSE_ALL_STATE_FILE_NAME))
    resetForkPauseAllCacheForTests()
    const running = await attachOnServer(sent)
    expect(running.outcome?.code).not.toBe(PAUSE_ALL_WORKER_START_CODE)
    expect(running.receipts).toBe(1)
    expect(running.placed).toHaveBeenCalled()
  })
})
