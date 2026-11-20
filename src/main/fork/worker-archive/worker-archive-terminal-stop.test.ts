import { describe, expect, it } from 'vitest'
import type { WorkerCleanupCandidate } from '../worker-cleanup/worker-cleanup-query'
import { pickWorkerTerminalsToStop } from './worker-archive-terminal-stop'

const MIN = 60_000

function candidate(over: Partial<WorkerCleanupCandidate> = {}): WorkerCleanupCandidate {
  return {
    resourceId: 'r',
    dispatchId: 'd',
    paneKey: 'tab:1',
    terminalHandle: 't',
    worktreeId: 'repo::/wt',
    doneAtMs: 0,
    unreadReport: false,
    pendingQuestion: false,
    ...over
  }
}

function pick(
  list: WorkerCleanupCandidate[],
  extra: { nowMs?: number; inTurn?: boolean; turnAt?: number } = {}
) {
  return pickWorkerTerminalsToStop({
    nowMs: extra.nowMs ?? 20 * MIN,
    stopAfterMs: 15 * MIN,
    candidates: list,
    inTurn: () => extra.inTurn === true,
    turnStartedAt: () => extra.turnAt
  })
}

describe('pickWorkerTerminalsToStop', () => {
  it('stops an idle finished worker once the delay has passed', () => {
    expect(pick([candidate()])).toHaveLength(1)
    expect(pick([candidate()], { nowMs: 14 * MIN })).toHaveLength(0)
  })

  it('leaves one with an open question, in a turn, or used again after it reported', () => {
    expect(pick([candidate({ pendingQuestion: true })])).toHaveLength(0)
    expect(pick([candidate()], { inTurn: true })).toHaveLength(0)
    expect(pick([candidate()], { turnAt: 10 * MIN })).toHaveLength(0)
  })

  it('reads a turn that started with the report as the reporting turn', () => {
    expect(pick([candidate()], { turnAt: 1_000 })).toHaveLength(1)
  })
})
