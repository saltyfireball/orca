import { describe, expect, it, vi } from 'vitest'
import { readForkBestOfSettings, type ForkBestOfAttempt } from '../../shared/fork/best-of/best-of'
import {
  startForkBestOf,
  type ForkBestOfStartDeps,
  type ForkBestOfWorkerStart
} from './best-of-start'
import { formatForkBestOfList, formatForkBestOfShow } from './best-of-format'

function deps(over: Partial<ForkBestOfStartDeps> = {}) {
  const started: ForkBestOfWorkerStart[] = []
  let n = 0
  const base: ForkBestOfStartDeps = {
    settings: readForkBestOfSettings({ forkBestOfAttemptNote: 'Attempt {{index}}/{{count}}' }),
    tag: 'abc123',
    startWorker: async (params) => {
      started.push(params)
      n += 1
      return { runId: 'run-1', taskId: `t${n}`, dispatchId: `d${n}`, state: 'ready' }
    },
    placeAuto: async () => 'kif',
    record: async (attempts: ForkBestOfAttempt[]) => ({
      id: 'abcdef123456',
      createdAt: 0,
      title: 'Fix it',
      prompt: 'Fix it',
      attempts
    })
  }
  return { started, deps: { ...base, ...over } }
}

describe('startForkBestOf', () => {
  it('starts each attempt in its own worktree, cycling agents and machines, in one Run', async () => {
    const { started, deps: d } = deps()
    const run = await startForkBestOf(
      { count: 3, prompt: 'Fix it', agents: 'claude:opus,codex', on: 'auto,here', repo: 'app' },
      d
    )
    expect(started.map((s) => [s.agent, s.model, s.on, s.run, s.name])).toEqual([
      ['claude', 'opus', 'kif', undefined, 'best-of-abc123-1'],
      ['codex', undefined, undefined, 'run-1', 'best-of-abc123-2'],
      ['claude', 'opus', 'kif', 'run-1', 'best-of-abc123-3']
    ])
    expect(started[1].spec).toBe('Fix it\n\n---\nAttempt 2/3')
    expect(started[0].repo).toBe('app')
    expect(run.attempts.map((a) => [a.index, a.host, a.dispatchId])).toEqual([
      [1, 'kif', 'd1'],
      [2, 'here', 'd2'],
      [3, 'kif', 'd3']
    ])
  })

  it('records failed starts and starts on this machine when auto has no repo', async () => {
    const notes: string[] = []
    const placeAuto = vi.fn(async () => 'kif')
    let calls = 0
    const { deps: d } = deps({
      placeAuto,
      note: (line) => notes.push(line),
      startWorker: async () => {
        calls += 1
        if (calls === 1) {
          throw new Error('agent not enabled')
        }
        return { runId: 'run-9', taskId: 't', dispatchId: `d${calls}`, state: 'ready' }
      }
    })
    const run = await startForkBestOf({ count: 2, prompt: 'Fix it' }, d)
    expect(placeAuto).not.toHaveBeenCalled()
    expect(run.attempts[0]).toMatchObject({ host: 'here', startError: 'agent not enabled' })
    expect(run.attempts[1]).toMatchObject({ host: 'here', runId: 'run-9' })
    expect(notes.some((line) => line.includes('needs --repo'))).toBe(true)
  })

  it('refuses when off, a bad count or an empty prompt, before starting anything', async () => {
    const { started, deps: d } = deps()
    await expect(
      startForkBestOf(
        { count: 2, prompt: 'x' },
        { ...d, settings: readForkBestOfSettings({ forkBestOf: false }) }
      )
    ).rejects.toThrow(/off/)
    await expect(startForkBestOf({ count: 5, prompt: 'x' }, d)).rejects.toThrow(/2 to 4/)
    await expect(startForkBestOf({ count: 2, prompt: '  ' }, d)).rejects.toThrow(/empty/)
    expect(started).toEqual([])
  })
})

describe('best-of format', () => {
  it('lists runs and shows each attempt', () => {
    const run = {
      id: 'abcdef123456',
      createdAt: Date.UTC(2026, 10, 18, 9, 30),
      title: 'Fix it',
      prompt: 'Fix it',
      attempts: [
        { index: 1, agent: 'claude', model: 'opus', host: 'here' },
        { index: 2, agent: 'codex', host: 'kif', outcome: { kind: 'archived' as const } }
      ],
      winner: 1
    }
    expect(formatForkBestOfList([])).toMatch(/No best-of runs/)
    expect(formatForkBestOfList([run])).toContain('picked 1')
    const text = formatForkBestOfShow(
      run,
      [
        {
          index: 1,
          worktreeId: 'w',
          environmentId: null,
          hostLabel: null,
          workerState: 'succeeded',
          workerError: null,
          taskStatus: 'completed',
          report: 'Done\nTests: pass',
          checks: { tests: 'pass', checks: 'unknown' },
          cost: { costUsd: 1.234, totalTokens: 12_000, subscriptionTokens: 0, unpricedTokens: 0 }
        }
      ],
      new Map([[1, { error: 'no base' }]])
    )
    expect(text).toContain('#1 claude opus on this machine [completed]')
    expect(text).toContain('diff: unavailable (no base)')
    expect(text).toContain('tests pass, checks not reported; cost $1.23 (estimate), 12k tokens')
    expect(text).toContain('#2 codex on kif [?] -> archived')
  })
})
