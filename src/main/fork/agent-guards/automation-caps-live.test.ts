// BAD-766: `orca guards automation-cap` against a real Store (class-backed AutomationPersistence),
// through the real RPC method, read back by the calls the automations and the engine use.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestStores, createStore, testState } from '../../persistence/persistence-test-harness'
import { readAgentGuardSettings } from '../../../shared/fork/agent-guards'
import { FORK_AGENT_GUARDS_METHODS } from '../../runtime/rpc/methods/fork/fork-agent-guards'
import type { RpcContext } from '../../runtime/rpc/core'
import { installForkUsageLedgerService } from '../usage-ledger/usage-ledger-service'
import { forkUsageLedgerObserveClaudeEvent } from '../usage-ledger/usage-ledger-service'
import { assistantFrame } from '../usage-ledger/usage-ledger-fixtures'
import { automationCapsPath } from './automation-caps-state'
import {
  agentGuardAutomationLimits,
  agentGuardAutomationRows,
  configureAgentGuardScopes,
  forkAutomationCapRefusal,
  loadAgentGuardScopeState
} from './agent-guards-scopes'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../telemetry/client', () => ({ track: vi.fn() }))

type Store = ReturnType<typeof createStore>

const flushes: (() => void)[] = []

function capMethod() {
  const found = FORK_AGENT_GUARDS_METHODS.find(
    (entry) => entry.name === 'fork.guards.automationCap'
  )
  if (!found) {
    throw new Error('no fork.guards.automationCap')
  }
  return found
}

async function setCap(id: string, flags: { run?: number | null; day?: number | null }) {
  const params = capMethod().params.parse({ id, ...flags })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the method reads no context.
  return capMethod().handler(params, {} as RpcContext)
}

async function bootstrap(): Promise<{ store: Store; automationId: string }> {
  const store = createStore()
  store.addRepo({
    id: 'r1',
    path: '/repo',
    displayName: 'demo',
    badgeColor: '#fff',
    addedAt: 1
  })
  const automation = store.createAutomation({
    name: 'Nightly report',
    prompt: 'Report',
    agentId: 'claude',
    projectId: 'r1',
    workspaceMode: 'existing',
    workspaceId: 'r1::wt1',
    timezone: 'UTC',
    rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
    dtstart: Date.now()
  })
  // The wiring startEngine does, with the host's real store behind requireStore.
  configureAgentGuardScopes({
    settings: () => readAgentGuardSettings(store.getSettings()),
    store: () => store
  })
  await loadAgentGuardScopeState(automationCapsPath(testState.dir))
  return { store, automationId: automation.id }
}

/** A finished run whose chat the ledger holds: 1M output tokens of claude-sonnet-4-5 cost $15. */
function spendFifteenDollars(store: Store, automationId: string, chatId: string): void {
  const run = store.createAutomationRun(store.listAutomations()[0], Date.now(), 'scheduled')
  store.updateAutomationRun({
    runId: run.id,
    status: 'dispatched',
    sessionKind: 'chat',
    chatSessionId: chatId
  })
  flushes.push(
    installForkUsageLedgerService({
      filePath: join(testState.dir, 'ledger.json'),
      readSettings: () => undefined,
      chatMeta: () => undefined
    })
  )
  forkUsageLedgerObserveClaudeEvent({
    type: 'message',
    sessionId: chatId,
    message: assistantFrame({ id: 'msg_1', output: 1_000_000 })
  })
  expect(store.listAutomationRuns(automationId)).toHaveLength(1)
}

beforeEach(() => {
  testState.dir = mkdtempSync(join(tmpdir(), 'fork-automation-caps-live-'))
})

afterEach(async () => {
  for (const flush of flushes.splice(0)) {
    flush()
  }
  await closeTestStores()
  rmSync(testState.dir, { recursive: true, force: true })
})

describe('orca guards automation-cap on a real store', () => {
  it('sets a per-run cap, shows it where the engine reads it, and default clears it', async () => {
    const { automationId } = await bootstrap()

    const result = await setCap(automationId, { run: 2 })

    expect(result).toEqual({ id: automationId, runCapUsd: 2, dayCapUsd: 0, weekCapUsd: 0 })
    expect(agentGuardAutomationRows(Date.now()).map((row) => row.runCapUsd)).toEqual([2])

    const cleared = await setCap(automationId, { run: null })

    expect(cleared.runCapUsd).toBe(0)
    expect(agentGuardAutomationRows(Date.now())).toEqual([])
  })

  it('refuses an unknown automation by its list, not by a crash', async () => {
    await bootstrap()

    await expect(setCap('no-such-automation', { run: 2 })).rejects.toThrow(/No automation/)
  })

  it('skips the next scheduled run once the day cap is spent, never a manual one', async () => {
    const { store, automationId } = await bootstrap()
    await setCap(automationId, { day: 5 })
    expect(forkAutomationCapRefusal(automationId, 'scheduled')).toBeNull()

    spendFifteenDollars(store, automationId, 'chat-1')

    expect(forkAutomationCapRefusal(automationId, 'scheduled')).toMatch(
      /daily spend cap of \$5\.00/
    )
    expect(forkAutomationCapRefusal(automationId, 'event')).toMatch(/daily spend cap/)
    expect(forkAutomationCapRefusal(automationId, 'manual')).toBeNull()

    await setCap(automationId, { day: null })
    expect(forkAutomationCapRefusal(automationId, 'scheduled')).toBeNull()
  })

  it('hands the engine a run limit with what the run spent, from the real store', async () => {
    const { store, automationId } = await bootstrap()
    await setCap(automationId, { run: 2 })
    spendFifteenDollars(store, automationId, 'chat-1')

    expect(agentGuardAutomationLimits('chat-1', automationId)).toEqual([
      { scope: 'automation-run', capUsd: 2, spentUsd: 15 }
    ])
  })
})
