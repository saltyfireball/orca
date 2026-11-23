// BAD-766: the worker start hook passes the terminal handle, so a terminal worker (no chat
// session) is noted for its coordinator's Run. This runs the real deliverAndSettleWorkerStartReadiness
// as far as its first fork line; the delivery after it is stopped on purpose.
import { describe, expect, it, vi } from 'vitest'

const deliver = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock(
  '../../runtime/rpc/methods/orchestration/worker/start/readiness/deliver-worker-dispatch-preamble',
  () => ({ deliverWorkerDispatchPreamble: deliver.run })
)

import { deliverAndSettleWorkerStartReadiness } from '../../runtime/rpc/methods/orchestration/worker/start/readiness/worker-start-readiness-settlement'
import { forkAgentQueueRunParent } from './agent-queue-service'

function start(over: { terminalHandle: string; coordinatorHandle: string; dispatchId: string }) {
  const db = { recordWorkerStage: vi.fn() }
  return deliverAndSettleWorkerStartReadiness({
    runtime: {},
    db,
    run: { id: 'run' },
    task: { id: 'task', spec: 'work' },
    dispatchDepth: 1,
    structuredSession: null,
    devMode: false,
    requestId: 'req',
    agent: 'codex',
    launchedAgent: 'codex',
    setupReceipt: {},
    launchReceipt: {},
    mode: {},
    timeoutMs: 1000,
    readinessDeadline: Date.now() + 1000,
    effects: [],
    terminalRevealWarning: undefined,
    onStage: () => undefined,
    ...over
  } as never)
}

describe('worker start of a terminal worker', () => {
  it('records the Run its coordinator started, by the terminal handle', async () => {
    deliver.run.mockRejectedValue(new Error('stop after the fork hook'))
    await expect(
      start({
        terminalHandle: 'term-worker-1',
        coordinatorHandle: 'orca_session_id:5b2e7d3f-9c4a-4f8b-8d26-1e3c7f9a2b48',
        dispatchId: 'd-1'
      })
    ).rejects.toThrow('stop after the fork hook')
    expect(forkAgentQueueRunParent({ terminalHandle: 'term-worker-1' })).toEqual({
      chat: '5b2e7d3f-9c4a-4f8b-8d26-1e3c7f9a2b48'
    })
  })

  it('records a terminal coordinator by its handle', async () => {
    deliver.run.mockRejectedValue(new Error('stop after the fork hook'))
    await expect(
      start({ terminalHandle: 'term-worker-2', coordinatorHandle: 'term-boss', dispatchId: 'd-2' })
    ).rejects.toThrow()
    expect(forkAgentQueueRunParent({ terminalHandle: 'term-worker-2' })).toEqual({
      handle: 'term-boss'
    })
  })
})
