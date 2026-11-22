import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../sqlite/sync-database'
import { contractInboxItems } from './contract-inbox'
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
})
