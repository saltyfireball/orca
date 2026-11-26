import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../sqlite/sync-database'
import { contractInboxItems } from './contract-inbox'
import {
  finishReviewRun,
  saveReviewGate,
  setReviewEscalated,
  startReviewRun
} from '../reviewer-gate/reviewer-store'
import { recordAttempt, saveContract } from './contract-store'

const handles: Database[] = []
afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.close()
  }
})

function reader(status: string) {
  const db = new Database(':memory:')
  handles.push(db)
  return { db, taskStatus: () => status }
}

describe('contractInboxItems', () => {
  it('lists an escalated Task until it completes', () => {
    const open = reader('dispatched')
    saveContract(open, 'task_1', { checks: ['pnpm test'], requirePrChecks: false, maxRounds: null })
    recordAttempt(open, {
      taskId: 'task_1',
      dispatchId: 'ctx_1',
      outcome: 'fail',
      results: [{ check: 'pnpm test', ok: false, exitCode: 1, output: 'x', durationMs: 1 }],
      failedRounds: 3,
      pendingReports: 0,
      escalated: true
    })
    expect(contractInboxItems(open)).toMatchObject([
      { source: 'contract', chatId: 'contract:task_1', verdict: 'stalled' }
    ])
    expect(contractInboxItems({ ...open, taskStatus: () => 'completed' })).toEqual([])
  })

  it('lists nothing for a Task that is not escalated', () => {
    const open = reader('dispatched')
    saveContract(open, 'task_1', { checks: ['x'], requirePrChecks: false, maxRounds: null })
    expect(contractInboxItems(open)).toEqual([])
  })

  it('lists a Task whose reviewer could not run, with the error, until it completes (BAD-820)', () => {
    const open = reader('dispatched')
    saveReviewGate(open, 'task_1', { focus: 'correctness', agent: null, maxRounds: null })
    const runId = startReviewRun(open, {
      taskId: 'task_1',
      round: 1,
      headKey: 'k',
      headSha: 'a'.repeat(40),
      reviewer: 'codex',
      model: 'default'
    })
    finishReviewRun(open, runId, {
      status: 'error',
      findingsCount: 0,
      output: "the reviewer's own sandbox failed (bwrap: x)\nmore"
    })
    expect(contractInboxItems(open)).toEqual([])
    setReviewEscalated(open, 'task_1', true)
    const [row] = contractInboxItems(open)
    expect(row).toMatchObject({ chatId: 'contract-review:task_1', source: 'contract' })
    expect(row?.reason).toContain("reviewer could not run: the reviewer's own sandbox failed")
    expect(contractInboxItems({ ...open, taskStatus: () => 'completed' })).toEqual([])
  })
})
