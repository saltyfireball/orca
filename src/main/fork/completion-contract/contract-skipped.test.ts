// BAD-763: a gate the Task asked for that does not run (setting off, or a folder with no commit to
// review) never passes silently: the done carries one plain line and `orca contract show` keeps it.
import Database from '../../sqlite/sync-database'
import { afterEach, describe, expect, it } from 'vitest'
import { readCompletionContractSettings } from '../../../shared/fork/completion-contract'
import { readReviewerGateSettings } from '../../../shared/fork/reviewer-gate'
import { formatForkContract } from '../../../cli/fork/completion-contract-handlers'
import { runReviewGate, type ReviewGateDeps } from '../reviewer-gate/reviewer-gate'
import { saveReviewGate } from '../reviewer-gate/reviewer-store'
import { runCompletionGate, type GateDeps, type GateRequest } from './completion-gate'
import { listAttempts, saveContract } from './contract-store'
import { forkTaskContractWire } from './contract-carry'

const handles: Database.Database[] = []
afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.close()
  }
})

const request: GateRequest = {
  taskId: 'task_1',
  dispatchId: 'ctx_1',
  worktreeId: 'wt_1',
  outcome: 'succeeded'
}

function open() {
  const db = new Database(':memory:')
  handles.push(db)
  return { db }
}

function contractDeps(handle: { db: Database.Database }, settings: object): GateDeps {
  return {
    db: handle,
    settings: () => readCompletionContractSettings(settings),
    host: () => 'build-box',
    workspace: async () => {
      throw new Error('a skipped gate must not look for the workspace')
    }
  }
}

function reviewDeps(
  handle: { db: Database.Database },
  settings: object,
  git = true
): ReviewGateDeps {
  return {
    db: handle,
    settings: () => readReviewerGateSettings(settings),
    host: () => 'build-box',
    workspace: async () => ({
      target: { cwd: '/w', connectionId: null },
      git,
      runner: async () => ({ exitCode: 1, output: '', timedOut: false })
    }),
    workerAgent: () => 'claude',
    deliver: async () => true
  }
}

describe('done checks that did not run', () => {
  it('says so, once per report, and records an attempt, when the setting is off', async () => {
    const handle = open()
    saveContract(handle, 'task_1', {
      checks: ['pnpm test'],
      requirePrChecks: false,
      maxRounds: null
    })
    const outcome = await runCompletionGate(
      contractDeps(handle, { forkCompletionContract: false }),
      request
    )
    expect(outcome).toEqual({
      kind: 'skipped',
      note: "Orca did not run this Task's 1 declared done check(s): the completion contract setting (forkCompletionContract) is off (on build-box)."
    })
    const attempts = listAttempts(handle, 'task_1')
    expect(attempts.map((a) => a.outcome)).toEqual(['skipped'])
    expect(attempts[0]!.results[0]!.output).toContain('forkCompletionContract')
  })

  it('stays silent for a Task with no contract and for a report that failed on purpose', async () => {
    const handle = open()
    const deps = contractDeps(handle, { forkCompletionContract: false })
    expect(await runCompletionGate(deps, request)).toEqual({ kind: 'none' })
    saveContract(handle, 'task_1', { checks: ['x'], requirePrChecks: false, maxRounds: null })
    expect(await runCompletionGate(deps, { ...request, outcome: 'failed' })).toEqual({
      kind: 'none'
    })
    expect(listAttempts(handle, 'task_1')).toEqual([])
  })
})

describe('a review that did not run', () => {
  it('says so when forkReviewerGate is off and the Task asked for the review', async () => {
    const handle = open()
    saveReviewGate(handle, 'task_1', { focus: 'correctness', agent: null, maxRounds: null })
    const outcome = await runReviewGate(reviewDeps(handle, { forkReviewerGate: false }), request)
    expect(outcome).toMatchObject({ kind: 'skipped' })
    expect((outcome as { note: string }).note).toBe(
      'Orca did not run the review this Task asked for: the reviewer gate setting (forkReviewerGate) is off (on build-box).'
    )
    expect(listAttempts(handle, 'task_1').map((a) => a.outcome)).toEqual(['skipped'])
  })

  it('says so in a folder workspace, which has no commit to review', async () => {
    const handle = open()
    saveReviewGate(handle, 'task_1', { focus: 'correctness', agent: null, maxRounds: null })
    const outcome = await runReviewGate(reviewDeps(handle, {}, false), request)
    expect((outcome as { note: string }).note).toContain('a folder, which has no commit to review')
  })

  it('adds no text for a review only the all-Tasks setting asked for', async () => {
    const off = open()
    expect(
      await runReviewGate(
        reviewDeps(off, { forkReviewerGate: false, forkReviewerGateAllTasks: true }),
        request
      )
    ).toEqual({ kind: 'none' })
    const folder = open()
    expect(
      await runReviewGate(reviewDeps(folder, { forkReviewerGateAllTasks: true }, false), request)
    ).toEqual({ kind: 'none' })
    // The second report finds the row the first one made, and it is still the setting's own.
    expect(
      await runReviewGate(reviewDeps(folder, { forkReviewerGateAllTasks: true }, false), request)
    ).toEqual({ kind: 'none' })
    expect(listAttempts(folder, 'task_1')).toEqual([])
    // And it is not carried to a server or a retry as if the Task had asked.
    expect(forkTaskContractWire(folder, 'task_1')).toBeNull()
  })

  it('adds no text for a failed report', async () => {
    const handle = open()
    saveReviewGate(handle, 'task_1', { focus: 'correctness', agent: null, maxRounds: null })
    expect(
      await runReviewGate(reviewDeps(handle, { forkReviewerGate: false }), {
        ...request,
        outcome: 'failed'
      })
    ).toEqual({ kind: 'none' })
  })
})

describe('orca contract show', () => {
  it('prints the skipped line for a review-only Task', () => {
    const text = formatForkContract({
      taskId: 'task_1',
      declared: false,
      checks: [],
      requirePrChecks: false,
      maxRounds: null,
      failedRounds: 0,
      escalated: false,
      review: null,
      attempts: [
        {
          at: '2026-11-23 10:00:00',
          dispatchId: 'ctx_1',
          outcome: 'skipped',
          results: [
            {
              check: 'not run',
              ok: true,
              exitCode: null,
              output: 'Orca did not run X',
              durationMs: 0
            }
          ]
        }
      ]
    })
    expect(text).toContain('skipped (ctx_1)')
    expect(text).toContain('Orca did not run X')
  })
})
