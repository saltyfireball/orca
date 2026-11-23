// BAD-766: a worker's Run survives an app restart. The links are read from the orchestration
// database (a Dispatch row names the worker and its creator), not from the worker start's
// in-memory notes, which a restart forgets. Each case builds the links, drops all module state the
// way a restart does, and builds the Run index again.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatOrcaSessionAddress } from '../../../shared/agent-session/identity/orca-session-address'
import { testOrcaSessionId } from '../../../shared/agent-session/identity/orca-session-address-test-fixture'
import { FORK_USAGE_NO_TOKENS } from '../../../shared/fork/usage-ledger'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { claudeUsageObservation } from '../usage-ledger/claude-usage-frames'
import { UsageLedger } from '../usage-ledger/usage-ledger'
import { assistantFrame, fakeClock, utcDay } from '../usage-ledger/usage-ledger-fixtures'

const LEAD = testOrcaSessionId('5b2e7d3f-9c4a-4f8b-8d26-1e3c7f9a2b48')
const WORKER_CHAT = testOrcaSessionId('6c3f8e4a-ad5b-4a9c-9e37-2f4d8a0b3c59')

let dir: string
let db: OrchestrationDb

beforeEach(async () => {
  vi.resetModules()
  dir = mkdtempSync(join(tmpdir(), 'orca-restart-links-'))
  const { OrchestrationDb: Db } = await import('../../runtime/orchestration/db/orchestration-db')
  db = new Db(join(dir, 'orchestration.db'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function dispatch(
  assigneeHandle: string,
  assigneePaneKey: string | undefined,
  creator: Parameters<OrchestrationDb['createDispatchContext']>[0]['creator']
): void {
  const task = db.createTask({ runId: 'run_legacy_local', spec: 'work' })
  db.createDispatchContext({
    taskId: task.id,
    assigneeHandle,
    assigneePaneKey,
    creator,
    maxDepth: 5
  })
}

function ledger() {
  const clock = fakeClock()
  const value = new UsageLedger({ now: clock.now, dayKey: utcDay })
  const observation = claudeUsageObservation(assistantFrame({ id: 'm1', input: 1_000_000 }))
  if (observation) {
    value.observe(LEAD, observation)
  }
  return value
}

const tokens = { ...FORK_USAGE_NO_TOKENS, inputTokens: 1_000_000 }

/** What a restart leaves: fresh modules, the saved ledger, the database, the live agents. */
async function indexAfterRestart(saved: ReturnType<UsageLedger['snapshot']>, live: string[]) {
  vi.resetModules()
  const { buildRunIndex, setAgentGuardDurableLinks } = await import('./agent-guards-run-index')
  const { createDurableRunLinks } = await import('./agent-guards-durable-links')
  setAgentGuardDurableLinks(createDurableRunLinks(() => db))
  return buildRunIndex(saved, new Set(live))
}

describe('Run links after a restart', () => {
  it('keeps a terminal worker of a chat in its Run, with the spend counted before', async () => {
    const value = ledger()
    value.observeTranscriptDelta('tab-w:worker-pane', 'codex', 'gpt-5', tokens)
    dispatch('term-w', 'tab-w:worker-pane', { kind: 'session', orcaSessionId: LEAD })
    const before = await indexAfterRestart(value.snapshot(), [LEAD, 'tab-w:worker-pane'])
    const run = before.get('tab-w:worker-pane')
    expect(run?.rootId).toBe(LEAD)
    expect(run?.memberIds.sort()).toEqual([LEAD, 'tab-w:worker-pane'].sort())
    expect(run?.uncounted).toBe(0)
    expect(run?.totalUsd).toBeGreaterThan(0)
  })

  it('keeps a terminal worker of a terminal in its Run', async () => {
    const value = ledger()
    value.observeTranscriptDelta('tab-b:boss-pane', 'claude', 'claude-sonnet-4-5', tokens)
    value.observeTranscriptDelta('tab-w:worker-pane', 'codex', 'gpt-5', tokens)
    dispatch('term-w', 'tab-w:worker-pane', {
      kind: 'terminal',
      handle: 'term-boss',
      paneKey: 'tab-b:boss-pane'
    })
    const index = await indexAfterRestart(value.snapshot(), [
      'tab-b:boss-pane',
      'tab-w:worker-pane'
    ])
    expect(index.get('tab-w:worker-pane')?.rootId).toBe('tab-b:boss-pane')
    expect(index.get('tab-b:boss-pane')?.totalUsd).toBeGreaterThan(0)
  })

  it('keeps a chat worker of a terminal in its Run, as not counted when it has no usage record', async () => {
    const value = ledger()
    value.observeTranscriptDelta('tab-b:boss-pane', 'claude', 'claude-sonnet-4-5', tokens)
    dispatch(formatOrcaSessionAddress(WORKER_CHAT), undefined, {
      kind: 'terminal',
      handle: 'term-boss',
      paneKey: 'tab-b:boss-pane'
    })
    const index = await indexAfterRestart(value.snapshot(), ['tab-b:boss-pane', WORKER_CHAT])
    const run = index.get(WORKER_CHAT)
    expect(run?.rootId).toBe('tab-b:boss-pane')
    expect(run?.uncounted).toBe(1)
  })

  it('leaves a worker nobody recorded out of every Run', async () => {
    const value = ledger()
    const index = await indexAfterRestart(value.snapshot(), [LEAD, 'tab-x:stray'])
    expect(index.size).toBe(0)
  })
})
