// BAD-766: the guards service reads worker links from the runtime's orchestration database, so a
// Run is rebuilt after a restart with nothing but the saved ledger and that database.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { testOrcaSessionId } from '../../../shared/agent-session/identity/orca-session-address-test-fixture'
import { FORK_USAGE_NO_TOKENS } from '../../../shared/fork/usage-ledger'

const state = vi.hoisted(() => ({ dataDir: '' }))
vi.mock('../../orca-profiles/profile-storage-paths', () => ({
  getProfileUserDataPath: () => state.dataDir
}))

const LEAD = testOrcaSessionId('5b2e7d3f-9c4a-4f8b-8d26-1e3c7f9a2b48')
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-service-links-'))
  state.dataDir = dir
  vi.resetModules()
  vi.stubEnv('VITEST', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

describe('guards service after a restart', () => {
  it('puts a terminal worker back in its coordinator Run from the orchestration database', async () => {
    const { OrchestrationDb } = await import('../../runtime/orchestration/db/orchestration-db')
    const db = new OrchestrationDb(join(dir, 'orchestration.db'))
    const task = db.createTask({ runId: 'run_legacy_local', spec: 'work' })
    db.createDispatchContext({
      taskId: task.id,
      assigneeHandle: 'term-w',
      assigneePaneKey: 'tab-w:worker-pane',
      creator: { kind: 'session', orcaSessionId: LEAD },
      maxDepth: 5
    })
    const ledger = await import('../usage-ledger/usage-ledger-service')
    ledger.installForkUsageLedgerService({
      filePath: join(dir, 'ledger.json'),
      readSettings: () => undefined,
      chatMeta: () => undefined
    })
    const tokens = { ...FORK_USAGE_NO_TOKENS, inputTokens: 1_000_000 }
    ledger.forkUsageLedgerObserveTranscriptDelta(LEAD, 'claude', 'claude-sonnet-4-5', tokens)
    ledger.forkUsageLedgerObserveTranscriptDelta('tab-w:worker-pane', 'codex', 'gpt-5', tokens)
    const guards = await import('./agent-guards-service')
    const scopes = await import('./agent-guards-scopes')
    scopes.setAgentGuardLiveIds(new Set([LEAD, 'tab-w:worker-pane']))
    guards.startForkAgentGuards({
      requireStore: () => ({ getSettings: () => ({}) }),
      getWorktreePs: async () => ({ worktrees: [] }),
      getExistingOrchestrationDb: () => db
    } as never)
    await vi.waitFor(() => expect(scopes.agentGuardRunOf('tab-w:worker-pane')?.rootId).toBe(LEAD), {
      timeout: 3000
    })
    db.close()
  })
})
