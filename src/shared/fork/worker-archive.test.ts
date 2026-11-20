// The archive decision: every hold, the delay, and what the checkout holds.
import { describe, expect, it, vi } from 'vitest'
import {
  decideWorkerWorkspace,
  forkWorkerArchiveDelayMinutes,
  forkWorkerArchiveEnabled,
  forkWorkerTerminalStopMinutes,
  type WorkerWorkspaceDispatchFacts,
  type WorkerWorkspaceFacts,
  type WorkerWorkspaceLanding
} from './worker-archive'

const HOUR = 3_600_000
const clean: WorkerWorkspaceLanding = { dirtyFiles: 0, unlandedCommits: 0 }

function dispatch(over: Partial<WorkerWorkspaceDispatchFacts> = {}): WorkerWorkspaceDispatchFacts {
  return { state: 'succeeded', finishedAtMs: 0, keptOpen: false, takenOver: false, ...over }
}

function facts(over: Partial<WorkerWorkspaceFacts> = {}): WorkerWorkspaceFacts {
  return { dispatches: [dispatch()], pinned: false, usedAfterDone: false, focused: false, ...over }
}

function decide(
  workspace: WorkerWorkspaceFacts,
  landing: WorkerWorkspaceLanding = clean,
  extra: { nowMs?: number; ignoreDelay?: boolean } = {}
) {
  const readLanding = vi.fn(async () => landing)
  return {
    readLanding,
    verdict: decideWorkerWorkspace({
      facts: workspace,
      nowMs: extra.nowMs ?? 3 * HOUR,
      delayMs: 2 * HOUR,
      ignoreDelay: extra.ignoreDelay ?? false,
      readLanding
    })
  }
}

describe('decideWorkerWorkspace', () => {
  it('archives a succeeded worker past the delay with nothing to lose', async () => {
    expect(await decide(facts()).verdict).toEqual({ kind: 'archive' })
  })

  it('archives a failed or abandoned worker only once it is older than the delay', async () => {
    for (const state of ['failed', 'abandoned']) {
      const workspace = facts({ dispatches: [dispatch({ state, finishedAtMs: HOUR })] })
      expect(await decide(workspace, clean, { nowMs: 2 * HOUR }).verdict).toEqual({
        kind: 'wait',
        dueAtMs: 3 * HOUR
      })
      expect(await decide(workspace, clean, { nowMs: 3 * HOUR }).verdict).toEqual({
        kind: 'archive'
      })
    }
  })

  it('waits out the delay, and a manual cleanup waives it', async () => {
    const workspace = facts({ dispatches: [dispatch({ finishedAtMs: 2 * HOUR })] })
    const waiting = decide(workspace)
    expect(await waiting.verdict).toEqual({ kind: 'wait', dueAtMs: 4 * HOUR })
    expect(waiting.readLanding).not.toHaveBeenCalled()
    expect(await decide(workspace, clean, { ignoreDelay: true }).verdict).toEqual({
      kind: 'archive'
    })
  })

  it('holds a worker that is running, starting or stopped', async () => {
    for (const state of ['ready', 'starting', 'stopping', 'start_unknown']) {
      const result = await decide(facts({ dispatches: [dispatch({ state })] })).verdict
      expect(result).toEqual({ kind: 'hold', reason: 'running' })
    }
    expect(await decide(facts({ dispatches: [dispatch({ state: 'stopped' })] })).verdict).toEqual({
      kind: 'hold',
      reason: 'stopped'
    })
  })

  it('holds a workspace while any dispatch that used it still runs', async () => {
    const workspace = facts({ dispatches: [dispatch(), dispatch({ state: 'ready' })] })
    expect(await decide(workspace).verdict).toEqual({ kind: 'hold', reason: 'running' })
  })

  it('holds what the user kept on purpose, without reading git', async () => {
    const cases: [Partial<WorkerWorkspaceFacts>, string][] = [
      [{ dispatches: [dispatch({ keptOpen: true })] }, 'kept-open'],
      [{ dispatches: [dispatch({ takenOver: true })] }, 'taken-over'],
      [{ pinned: true }, 'pinned'],
      [{ usedAfterDone: true }, 'used-after-done'],
      [{ focused: true }, 'focused']
    ]
    for (const [over, reason] of cases) {
      const { verdict, readLanding } = decide(facts(over))
      expect(await verdict).toEqual({ kind: 'hold', reason })
      expect(readLanding).not.toHaveBeenCalled()
    }
  })

  it('blocks on uncommitted or untracked changes', async () => {
    const landing = { dirtyFiles: 2, unlandedCommits: 0 }
    expect(await decide(facts(), landing).verdict).toEqual({
      kind: 'blocked',
      reason: 'uncommitted-changes',
      landing
    })
  })

  it('blocks on commits that are on no base branch', async () => {
    const landing = { dirtyFiles: 0, unlandedCommits: 3 }
    expect(await decide(facts(), landing).verdict).toEqual({
      kind: 'blocked',
      reason: 'unmerged-commits',
      landing
    })
  })

  it('blocks when git cannot be read', async () => {
    for (const landing of [
      { dirtyFiles: null, unlandedCommits: 0 },
      { dirtyFiles: 0, unlandedCommits: null }
    ]) {
      expect(await decide(facts(), landing).verdict).toMatchObject({
        kind: 'blocked',
        reason: 'git-unknown'
      })
    }
  })

  it('holds a workspace with no dispatch at all', async () => {
    expect(await decide(facts({ dispatches: [] })).verdict).toEqual({
      kind: 'hold',
      reason: 'running'
    })
  })
})

describe('settings', () => {
  it('default to on, 2 hours and 15 minutes, and ignore nonsense', () => {
    expect(forkWorkerArchiveEnabled({})).toBe(true)
    expect(forkWorkerArchiveEnabled({ forkWorkerArchive: false })).toBe(false)
    expect(forkWorkerArchiveDelayMinutes({})).toBe(120)
    expect(forkWorkerArchiveDelayMinutes({ forkWorkerArchiveDelayMinutes: 30 })).toBe(30)
    expect(forkWorkerArchiveDelayMinutes({ forkWorkerArchiveDelayMinutes: -5 })).toBe(120)
    expect(forkWorkerArchiveDelayMinutes({ forkWorkerArchiveDelayMinutes: 1.5 })).toBe(120)
    expect(forkWorkerTerminalStopMinutes(undefined)).toBe(15)
    expect(forkWorkerTerminalStopMinutes({ forkWorkerTerminalStopMinutes: 5 })).toBe(5)
  })
})
