// BAD-766: a Run's index counts terminal workers (and chat workers a terminal started) through the
// usage ledger, and says how many of its agents have no usage record.
import { describe, expect, it } from 'vitest'
import { forkAgentQueueNoteWorker } from '../agent-queue/agent-queue-service'
import { UsageLedger } from '../usage-ledger/usage-ledger'
import { claudeUsageObservation } from '../usage-ledger/claude-usage-frames'
import { assistantFrame, fakeClock, utcDay } from '../usage-ledger/usage-ledger-fixtures'
import { FORK_USAGE_NO_TOKENS } from '../../../shared/fork/usage-ledger'
import { buildRunIndex, setAgentGuardTerminalLinks } from './agent-guards-run-index'

function ledgerWithLead() {
  const clock = fakeClock()
  const ledger = new UsageLedger({ now: clock.now, dayKey: utcDay })
  const observation = claudeUsageObservation(assistantFrame({ id: 'm1', input: 1_000_000 }))
  if (observation) {
    ledger.observe('lead-chat', observation)
  }
  return ledger
}

describe('buildRunIndex', () => {
  it('puts a terminal worker the coordinator started into the coordinator Run', () => {
    const ledger = ledgerWithLead()
    ledger.observeTranscriptDelta('pane-w', 'codex', 'gpt-5', {
      ...FORK_USAGE_NO_TOKENS,
      inputTokens: 1_000_000
    })
    forkAgentQueueNoteWorker({
      session: null,
      from: 'orca_session_id:lead-chat',
      dispatchId: 'd1',
      terminalHandle: 'term-w'
    })
    setAgentGuardTerminalLinks({
      handleOf: (pane) => (pane === 'pane-w' ? 'term-w' : undefined),
      paneOf: () => undefined
    })
    const index = buildRunIndex(ledger.snapshot(), new Set(['lead-chat', 'pane-w']))
    const run = index.get('pane-w')
    expect(run?.rootId).toBe('lead-chat')
    expect(index.get('lead-chat')).toBe(run)
    expect(run?.memberIds.sort()).toEqual(['lead-chat', 'pane-w'])
    expect(run?.totalUsd).toBeGreaterThan(0)
    expect(run?.uncounted).toBe(0)
  })

  it('links a worker to a terminal coordinator through the coordinator pane, and counts agents with no record as not counted', () => {
    const ledger = ledgerWithLead()
    ledger.observeTranscriptDelta('pane-boss', 'claude', 'claude-sonnet-4-5', {
      ...FORK_USAGE_NO_TOKENS,
      inputTokens: 10
    })
    forkAgentQueueNoteWorker({
      session: null,
      from: 'term-boss',
      dispatchId: 'd2',
      terminalHandle: 'term-pi'
    })
    setAgentGuardTerminalLinks({
      handleOf: (pane) => ({ 'pane-boss': 'term-boss', 'pane-pi': 'term-pi' })[pane],
      paneOf: (handle) => (handle === 'term-boss' ? 'pane-boss' : undefined)
    })
    const index = buildRunIndex(ledger.snapshot(), new Set(['pane-boss', 'pane-pi']))
    const run = index.get('pane-pi')
    expect(run?.rootId).toBe('pane-boss')
    expect(run?.uncounted).toBe(1)
    expect(run?.memberIds.sort()).toEqual(['pane-boss', 'pane-pi'])
  })

  it('leaves an agent that nobody started out of every Run', () => {
    const ledger = ledgerWithLead()
    setAgentGuardTerminalLinks({
      handleOf: () => undefined,
      paneOf: () => undefined
    })
    const index = buildRunIndex(ledger.snapshot(), new Set(['lead-chat', 'pane-solo']))
    expect(index.size).toBe(0)
  })
})
