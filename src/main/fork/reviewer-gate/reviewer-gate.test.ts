import Database from '../../sqlite/sync-database'
import { afterEach, describe, expect, it } from 'vitest'
import { readReviewerGateSettings } from '../../../shared/fork/reviewer-gate'
import type { CheckRunner } from '../completion-contract/check-runner'
import { runReviewGate, type ReviewGateDeps, type ReviewGateRequest } from './reviewer-gate'
import { listReviewRuns, readReviewGate, saveReviewGate } from './reviewer-store'

const handles: Database.Database[] = []
afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.close()
  }
})

const sha = (n: number): string => String(n).repeat(40)

/** A checkout whose head the test moves, and a reviewer that prints what the test queued. */
function fixture(options?: { maxRounds?: number; delivered?: string[]; mutate?: boolean }) {
  const escalations: string[] = []
  const db = new Database(':memory:')
  handles.push(db)
  const state = {
    head: 1,
    replies: [] as string[],
    exitCodes: [] as number[],
    reviewerCommands: [] as string[],
    extra: ''
  }
  const runner: CheckRunner = async (_target, command) => {
    if (command.startsWith('git rev-parse')) {
      return { exitCode: 0, output: `${sha(state.head)}\n${state.extra}`, timedOut: false }
    }
    state.reviewerCommands.push(command)
    if (options?.mutate) {
      state.extra = ' M changed.ts\n'
    }
    return {
      exitCode: state.exitCodes.shift() ?? 0,
      output: state.replies.shift() ?? '',
      timedOut: false
    }
  }
  const delivered = options?.delivered ?? []
  const deps: ReviewGateDeps = {
    db: { db },
    settings: () =>
      readReviewerGateSettings({
        forkReviewerGateMaxRounds: options?.maxRounds,
        forkReviewerGateAllTasks: false
      }),
    workspace: async () => ({ target: { cwd: '/w', connectionId: null }, git: true, runner }),
    workerAgent: () => 'claude',
    deliver: async (_dispatchId, text) => {
      delivered.push(text)
      return true
    },
    escalate: async ({ text }) => {
      escalations.push(text)
    },
    platform: 'linux',
    sleep: async () => undefined
  }
  const request: ReviewGateRequest = {
    taskId: 'task_1',
    dispatchId: 'ctx_1',
    worktreeId: 'wt_1',
    outcome: 'succeeded'
  }
  saveReviewGate({ db }, 'task_1', { focus: 'security', agent: null, maxRounds: null })
  const settled = async (): Promise<void> => {
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => setImmediate(resolve))
    }
  }
  return { db, deps, request, state, delivered, escalations, settled }
}

describe('runReviewGate', () => {
  it('leaves a Task that asked for no review alone', async () => {
    const f = fixture()
    expect(await runReviewGate(f.deps, { ...f.request, taskId: 'task_other' })).toEqual({
      kind: 'none'
    })
  })

  it('starts exactly one reviewer per head and holds the report', async () => {
    const f = fixture()
    f.state.replies.push('Looks fine.\nVERDICT: CLEAN')
    const first = await runReviewGate(f.deps, f.request)
    expect(first.kind).toBe('hold')
    await f.settled()
    expect(await runReviewGate(f.deps, f.request)).toMatchObject({ kind: 'pass' })
    expect(f.state.reviewerCommands).toHaveLength(1)
    expect(f.state.reviewerCommands[0]).toContain('codex exec')
    expect(f.state.reviewerCommands[0]).toContain('--sandbox read-only')
    expect(f.delivered[0]).toContain('found nothing that must change')
    expect(listReviewRuns({ db: f.db }, 'task_1')).toMatchObject([
      { reviewer: 'codex', status: 'clean', round: 1 }
    ])
  })

  it('does not start a second reviewer while the first runs', async () => {
    const f = fixture()
    let release: () => void = () => undefined
    const slow: CheckRunner = async (_target, command) => {
      if (command.startsWith('git rev-parse')) {
        return { exitCode: 0, output: `${sha(1)}\n`, timedOut: false }
      }
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { exitCode: 0, output: 'VERDICT: CLEAN', timedOut: false }
    }
    const deps = {
      ...f.deps,
      workspace: async () => ({
        target: { cwd: '/w', connectionId: null },
        git: true,
        runner: slow
      })
    }
    await runReviewGate(deps, f.request)
    const again = await runReviewGate(deps, f.request)
    expect(again).toMatchObject({ kind: 'hold', text: expect.stringContaining('still running') })
    release()
    await f.settled()
    expect(listReviewRuns({ db: f.db }, 'task_1')).toHaveLength(1)
  })

  it('tells findings to the worker and keeps the Task open until a new head is clean', async () => {
    const f = fixture()
    f.state.replies.push('1. bug in a.ts line 3\nVERDICT: FINDINGS 1', 'VERDICT: CLEAN')
    await runReviewGate(f.deps, f.request)
    await f.settled()
    expect(f.delivered[0]).toContain('bug in a.ts line 3')
    expect(f.delivered[0]).toContain('data written by another agent')
    const same = await runReviewGate(f.deps, f.request)
    expect(same).toMatchObject({ kind: 'hold', text: expect.stringContaining('has not changed') })
    f.state.head = 2
    expect((await runReviewGate(f.deps, f.request)).kind).toBe('hold')
    await f.settled()
    expect(await runReviewGate(f.deps, f.request)).toMatchObject({ kind: 'pass' })
    expect(f.state.reviewerCommands).toHaveLength(2)
    expect(listReviewRuns({ db: f.db }, 'task_1').map((run) => run.round)).toEqual([1, 2])
  })

  it('escalates once the rounds are used up', async () => {
    const f = fixture({ maxRounds: 1 })
    f.state.replies.push('VERDICT: FINDINGS 2', 'VERDICT: FINDINGS 1')
    await runReviewGate(f.deps, f.request)
    await f.settled()
    f.state.head = 2
    await runReviewGate(f.deps, f.request)
    await f.settled()
    expect(f.delivered[1]).toContain('rounds are used up')
    const last = await runReviewGate(f.deps, f.request)
    expect(last.kind).toBe('escalate')
    expect(readReviewGate({ db: f.db }, 'task_1')?.escalated).toBe(true)
  })

  it('retries an unreadable review itself, then escalates to the coordinator and tells the worker to wait', async () => {
    const f = fixture()
    f.state.replies.push('no verdict here', 'still nothing')
    await runReviewGate(f.deps, f.request)
    await f.settled()
    expect(f.state.reviewerCommands).toHaveLength(2)
    expect(listReviewRuns({ db: f.db }, 'task_1').map((run) => run.status)).toEqual([
      'error',
      'error'
    ])
    expect(f.escalations).toHaveLength(1)
    expect(f.escalations[0]).toContain('reviewer could not run')
    expect(readReviewGate({ db: f.db }, 'task_1')?.escalated).toBe(true)
    expect(f.delivered).toHaveLength(1)
    expect(f.delivered[0]).toContain('reviewer failed')
    expect(f.delivered[0]).toContain('Do not commit')
    expect((await runReviewGate(f.deps, f.request)).kind).toBe('escalate')
    expect(f.state.reviewerCommands).toHaveLength(2)
  })

  describe('a reviewer that errored is not a finding (BAD-820)', () => {
    const sandboxFailure =
      'bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted\nVERDICT: FINDINGS 1'

    it('treats a sandbox failure, even with a verdict line after it, as an error that spends no round', async () => {
      const f = fixture()
      f.state.replies.push(sandboxFailure, 'VERDICT: CLEAN')
      f.state.exitCodes.push(1, 0)
      await runReviewGate(f.deps, f.request)
      await f.settled()
      const runs = listReviewRuns({ db: f.db }, 'task_1')
      expect(runs.map((run) => run.status)).toEqual(['error', 'clean'])
      expect(runs.map((run) => run.round)).toEqual([1, 1])
      expect(f.escalations).toEqual([])
      expect(f.delivered).toHaveLength(1)
      expect(f.delivered[0]).not.toContain('finding(s)')
      expect(await runReviewGate(f.deps, f.request)).toMatchObject({ kind: 'pass' })
    })

    it('escalates with the error when every try hits the sandbox failure, and never asks for a commit', async () => {
      const f = fixture()
      f.state.replies.push(sandboxFailure, sandboxFailure)
      await runReviewGate(f.deps, f.request)
      await f.settled()
      expect(f.escalations[0]).toContain('reviewer could not run: the reviewer')
      expect(f.escalations[0]).toContain('RTM_NEWADDR')
      expect(f.delivered[0]).not.toMatch(/commit,? then|new commit/u)
      expect(f.delivered[0]).toContain('Wait')
      const again = await runReviewGate(f.deps, f.request)
      expect(again.kind).toBe('escalate')
      expect(again).not.toMatchObject({ text: expect.stringContaining('has not changed') })
    })

    it('treats a reviewer that printed nothing as an error', async () => {
      const f = fixture()
      f.state.replies.push('', '   \n')
      f.state.exitCodes.push(0, 0)
      await runReviewGate(f.deps, f.request)
      await f.settled()
      const runs = listReviewRuns({ db: f.db }, 'task_1')
      expect(runs.map((run) => run.status)).toEqual(['error', 'error'])
      expect(runs[0]?.output).toContain('printed nothing')
      expect(f.escalations).toHaveLength(1)
    })

    it('still treats a real finding as a finding: a round is spent and a new commit is expected', async () => {
      const f = fixture()
      f.state.replies.push('1. bug in a.ts line 3\nVERDICT: FINDINGS 1')
      await runReviewGate(f.deps, f.request)
      await f.settled()
      expect(listReviewRuns({ db: f.db }, 'task_1')).toMatchObject([
        { status: 'findings', round: 1 }
      ])
      expect(f.escalations).toEqual([])
      expect(f.delivered[0]).toContain('Fix what is real, commit')
      expect(await runReviewGate(f.deps, f.request)).toMatchObject({
        kind: 'hold',
        text: expect.stringContaining('has not changed')
      })
    })
  })

  it('does not trust a review that changed the checkout', async () => {
    const f = fixture({ mutate: true })
    f.state.replies.push('VERDICT: CLEAN')
    await runReviewGate(f.deps, f.request)
    await f.settled()
    expect(listReviewRuns({ db: f.db }, 'task_1')[0]).toMatchObject({ status: 'error' })
  })

  it('does not review a report of failure', async () => {
    const f = fixture()
    expect(await runReviewGate(f.deps, { ...f.request, outcome: 'failed' })).toEqual({
      kind: 'none'
    })
  })
})
