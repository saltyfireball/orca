// BAD-822: `orca agent close` is a close a person asks for. The chat closes through the real
// fork.agent.close handler (closeAgentChat) on a real chat host, the goal ends through the real
// sweep and store; only the live list is a fake. The automation run sweep shares the close and is
// not a person, so a goal there still ends as lost.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readGoalLoopSettings } from '../../../shared/fork/goal-loop'
import { closeTestStores, testState } from '../../persistence/persistence-test-harness'
import { setStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import {
  createQueuedMessageTestRig,
  type QueuedMessageTestRig
} from '../../native-chat/agent-session-wire/host/testing/structured-agent-session-queued-message-rig.test-fixture'
import { FORK_AGENT_CLOSE_METHODS } from '../../runtime/rpc/methods/fork/fork-agent-close'
import {
  closeFinishedChat,
  runtimeFinishedChatCloseDeps
} from '../automation-run-close/finished-chat-close'
import { setForkGoalCloseListener } from './goal-close-notes'
import { createGoalService, type GoalServiceDeps } from './goal-service'
import { readGoals, writeGoals } from './goal-store'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8').slice('encrypted:'.length)
  }
}))

const CHAT = '5b0f6d3e-2a41-4c8e-9d17-3e6a0c4b8f21'

let rig: QueuedMessageTestRig
let dir = ''

async function settleTurn(): Promise<void> {
  await rig.store.updateRecord(CHAT, {
    kind: 'last-turn',
    lastTurn: {
      state: 'settled',
      outcome: 'success',
      at: 1,
      prompt: 'Fix the parser'
    }
  })
}

function goalHost() {
  const path = join(dir, 'fork-goal-loop.json')
  let live = true
  const notifyStopped = vi.fn<GoalServiceDeps['notifyStopped']>()
  const service = createGoalService({
    now: () => 9_000_000,
    settings: () => readGoalLoopSettings({}),
    loadGoals: () => readGoals(path),
    saveGoals: (goals) => writeGoals(path, goals),
    candidates: async () => [],
    liveAgents: async () =>
      live
        ? [
            {
              id: CHAT,
              kind: 'chat' as const,
              agent: 'claude',
              title: 'Fix',
              worktreeId: null
            }
          ]
        : [],
    restored: () => true,
    workerFinished: () => false,
    fingerprint: async () => '',
    agentOutput: async () => null,
    spentTotalUsd: () => 0,
    send: vi.fn(async () => true),
    runCheck: async () => ({ ok: false, output: 'still red' }),
    judge: async () => ({ met: false, reason: '' }),
    notifyStopped,
    changed: () => {}
  })
  // As startForkGoalLoop wires it.
  setForkGoalCloseListener((ids) => void service.noteClosed(ids))
  return { service, notifyStopped, gone: () => (live = false) }
}

async function endedGoal(service: ReturnType<typeof createGoalService>) {
  for (let index = 0; index < 12; index += 1) {
    await service.sweep()
  }
  return (await service.list()).goals[0]
}

describe('a goal on a chat closed with orca agent close (BAD-822)', () => {
  beforeEach(async () => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-goal-close-test-'))
    dir = testState.dir
    rig = await createQueuedMessageTestRig({ sessionId: CHAT })
    setStructuredAgentSessionHost(rig.host)
    await rig.host.setSessionTabVisibility(CHAT, true)
    await settleTurn()
  })
  afterEach(async () => {
    setStructuredAgentSessionHost(null)
    await rig.dispose()
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('ends quietly as gone, with no inbox row and no notice', async () => {
    const h = goalHost()
    await h.service.set({ id: CHAT, untilCmd: 'pnpm test' })
    const runtime = { openAgentSessionRecordStore: async () => rig.store }
    const [method] = FORK_AGENT_CLOSE_METHODS
    const result = await method.handler({ id: `orca_session_id:${CHAT}` }, {
      runtime
    } as never)
    expect(result).toEqual({ closed: true, sessionId: CHAT })
    await vi.waitFor(async () =>
      expect((await readGoals(join(dir, 'fork-goal-loop.json'))).get(CHAT)?.closedAt).toBe(
        9_000_000
      )
    )
    h.gone()
    const goal = await endedGoal(h.service)
    expect(goal.stop?.reason).toBe('gone')
    expect(await h.service.inboxItems()).toEqual([])
    expect(h.notifyStopped).not.toHaveBeenCalled()
  })

  it('a refused close (the agent is working) notes nothing', async () => {
    const h = goalHost()
    await h.service.set({ id: CHAT, untilCmd: 'pnpm test' })
    await rig.store.updateRecord(CHAT, {
      kind: 'last-turn',
      lastTurn: { state: 'open', at: 2, prompt: 'Fix the parser' }
    })
    const [method] = FORK_AGENT_CLOSE_METHODS
    const result = await method.handler({ id: `orca_session_id:${CHAT}` }, {
      runtime: { openAgentSessionRecordStore: async () => rig.store }
    } as never)
    expect(result).toMatchObject({ closed: false, reason: 'working' })
    expect((await readGoals(join(dir, 'fork-goal-loop.json'))).get(CHAT)?.closedAt).toBeUndefined()
  })

  it('the automation run sweep close is not a person: the goal ends as agent-lost', async () => {
    const h = goalHost()
    await h.service.set({ id: CHAT, untilCmd: 'pnpm test' })
    const outcome = await closeFinishedChat(runtimeFinishedChatCloseDeps(rig.store), CHAT)
    expect(outcome).toEqual({ closed: true })
    h.gone()
    const goal = await endedGoal(h.service)
    expect(goal.stop?.reason).toBe('agent-lost')
    expect(await h.service.inboxItems()).toHaveLength(1)
  })
})
