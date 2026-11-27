import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../sqlite/sync-database'
import { contractInboxItems } from './contract-inbox'
import {
  finishReviewRun,
  saveReviewGate,
  setReviewEscalated,
  setReviewWorkerTold,
  startReviewRun
} from '../reviewer-gate/reviewer-store'
import { recordAttempt, saveContract } from './contract-store'

const handles: Database[] = []
afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.close()
  }
})

/** A Task in `status`; `held` while its worker is still on it (BAD-820). */
function reader(status: string, held = true) {
  const db = new Database(':memory:')
  handles.push(db)
  return { db, taskStatus: () => status, taskHeld: () => held }
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

  it('resolves a row once its worker no longer holds the Task, or the Task failed (BAD-820)', () => {
    const open = reader('dispatched')
    saveReviewGate(open, 'task_1', { focus: 'correctness', agent: null, maxRounds: null })
    saveReviewGate(open, 'task_2', { focus: 'correctness', agent: null, maxRounds: null })
    setReviewEscalated(open, 'task_1', true)
    setReviewEscalated(open, 'task_2', true)
    expect(contractInboxItems(open)).toHaveLength(2)

    const stopped = {
      ...open,
      taskStatus: () => 'blocked',
      taskHeld: (id: string) => id !== 'task_1'
    }
    expect(contractInboxItems(stopped).map((row) => row.chatId)).toEqual(['contract-review:task_2'])
    const failed = { ...open, taskStatus: () => 'failed' }
    expect(contractInboxItems(failed)).toEqual([])
    // Resolved for good: the Task held again (a new attempt) does not bring the old rows back.
    expect(contractInboxItems(open)).toEqual([])
  })

  it('leaves the row of a Task this host does not know alone', () => {
    const open = reader('dispatched')
    saveReviewGate(open, 'task_1', { focus: 'correctness', agent: null, maxRounds: null })
    setReviewEscalated(open, 'task_1', true)
    expect(contractInboxItems({ ...open, taskStatus: () => null })).toEqual([])
    expect(contractInboxItems(open)).toHaveLength(1)
  })

  it('words the reviewer-error row by how the worker was told (BAD-820)', () => {
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
    finishReviewRun(open, runId, { status: 'error', findingsCount: 0, output: 'no verdict' })
    setReviewEscalated(open, 'task_1', true)
    const reason = () => contractInboxItems(open)[0]?.reason ?? ''
    expect(reason()).toContain('Orca is still telling its worker to wait')
    setReviewWorkerTold(open, 'task_1', 'sent')
    expect(reason()).toContain('its worker was told to wait')
    setReviewWorkerTold(open, 'task_1', 'mailed')
    expect(reason()).toContain('is in its orchestration mailbox')
    setReviewWorkerTold(open, 'task_1', 'not-told')
    expect(reason()).toContain('could not be told to wait')
  })
})
