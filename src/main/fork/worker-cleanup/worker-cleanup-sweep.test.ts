import { describe, expect, it, vi } from 'vitest'
import type { WorkerCleanupCandidate } from './worker-cleanup-query'
import {
  MERGED_CACHE_MS,
  runWorkerCleanupSweep,
  WorkerCleanupMemory,
  type WorkerCleanupSweepDeps
} from './worker-cleanup-sweep'

const DONE = 1_000_000_000
const MIN = 60_000

function candidate(overrides: Partial<WorkerCleanupCandidate> = {}): WorkerCleanupCandidate {
  return {
    resourceId: 'res-1',
    dispatchId: 'dispatch-1',
    paneKey: 'tab-1:pane-1',
    terminalHandle: 'term-1',
    worktreeId: 'repo-1::/work/wt-1',
    doneAtMs: DONE,
    unreadReport: false,
    pendingQuestion: false,
    ...overrides
  }
}

function deps(overrides: Partial<WorkerCleanupSweepDeps> = {}): WorkerCleanupSweepDeps {
  return {
    settings: { forkWorkerCleanup: true },
    nowMs: DONE + 5 * MIN,
    candidates: [candidate()],
    inTurn: () => false,
    turnStartedAt: () => undefined,
    worktreePath: () => '/work/wt-1',
    worktreeState: async () => ({ dirty: 0, unpushed: 0 }),
    isMerged: async () => false,
    chatSession: () => null,
    close: async (list) =>
      list.map((c) => ({
        kind: 'terminal-closed',
        worktreeId: c.worktreeId ?? '',
        handle: c.terminalHandle
      })),
    release: async () => true,
    ...overrides
  }
}

async function sweep(
  overrides: Partial<WorkerCleanupSweepDeps> = {},
  memory = new WorkerCleanupMemory()
) {
  return runWorkerCleanupSweep(deps(overrides), memory)
}

describe('worker cleanup sweep: done trigger', () => {
  it('closes a finished worker once the grace has passed', async () => {
    const close = vi.fn(deps().close)
    const result = await sweep({ close })
    expect(close).toHaveBeenCalledOnce()
    expect(result.items).toEqual([
      {
        kind: 'terminal-closed',
        worktreeId: 'repo-1::/work/wt-1',
        handle: 'term-1'
      }
    ])
  })

  it('waits for the grace minutes from the setting', async () => {
    const close = vi.fn(deps().close)
    const result = await sweep({ close, nowMs: DONE + 4 * MIN })
    expect(close).not.toHaveBeenCalled()
    expect(result.skipped.get('res-1')).toBe('not-due')
    const later = await sweep({
      settings: { forkWorkerCleanup: true, forkWorkerCleanupGraceMinutes: 1 },
      nowMs: DONE + MIN
    })
    expect(later.items).toHaveLength(1)
  })

  it('does nothing on done when the done trigger is off', async () => {
    const result = await sweep({
      settings: { forkWorkerCleanup: true, forkWorkerCleanupOnDone: false },
      nowMs: DONE + 60 * MIN
    })
    expect(result.skipped.get('res-1')).toBe('not-due')
  })
})

describe('worker cleanup sweep: merged trigger', () => {
  const settings = {
    forkWorkerCleanup: true,
    forkWorkerCleanupOnDone: false,
    forkWorkerCleanupOnMerged: true
  }

  it('closes before the grace when the branch is merged', async () => {
    const result = await sweep({
      settings,
      nowMs: DONE + 1_000,
      isMerged: async () => true
    })
    expect(result.items).toHaveLength(1)
  })

  it('leaves an unmerged branch alone and treats a failing check as not merged', async () => {
    expect((await sweep({ settings })).skipped.get('res-1')).toBe('not-due')
    const failing = await sweep({
      settings,
      isMerged: async () => {
        throw new Error('no gh')
      }
    })
    expect(failing.skipped.get('res-1')).toBe('not-due')
  })

  it('asks once per worktree within the cache window', async () => {
    const memory = new WorkerCleanupMemory()
    const isMerged = vi.fn(async () => false)
    await sweep({ settings, isMerged }, memory)
    await sweep({ settings, isMerged, nowMs: DONE + 5 * MIN + MERGED_CACHE_MS - 1 }, memory)
    expect(isMerged).toHaveBeenCalledOnce()
    await sweep({ settings, isMerged, nowMs: DONE + 5 * MIN + MERGED_CACHE_MS }, memory)
    expect(isMerged).toHaveBeenCalledTimes(2)
  })
})

describe('worker cleanup sweep: guards', () => {
  it.each([
    ['question-open', { candidates: [candidate({ pendingQuestion: true })] }],
    ['report-unread', { candidates: [candidate({ unreadReport: true })] }],
    ['in-turn', { inTurn: () => true }],
    ['no-local-worktree', { worktreePath: () => null }],
    ['used-after-done', { turnStartedAt: () => DONE + 2_000 }],
    ['worktree-unknown', { worktreeState: async () => ({ dirty: null, unpushed: 0 }) }],
    [
      'worktree-unknown',
      {
        worktreeState: async () => {
          throw new Error('git gone')
        }
      }
    ]
  ] as const)('leaves the worker open: %s', async (why, overrides) => {
    const close = vi.fn(deps().close)
    const result = await sweep({
      ...overrides,
      close
    } as Partial<WorkerCleanupSweepDeps>)
    expect(result.skipped.get('res-1')).toBe(why)
    expect(close).not.toHaveBeenCalled()
  })

  it('counts the reporting turn itself as before done', async () => {
    const result = await sweep({ turnStartedAt: () => DONE + 1_000 })
    expect(result.items).toHaveLength(1)
  })

  it('marks a worker with uncommitted or unpushed work instead of closing it', async () => {
    const dirty = await sweep({
      worktreeState: async () => ({ dirty: 2, unpushed: 1 }),
      chatSession: () => 'chat-1'
    })
    expect(dirty.items).toEqual([])
    expect(dirty.held).toEqual([
      { paneKey: 'tab-1:pane-1', sessionId: 'chat-1', reason: 'uncommitted' }
    ])
    const unpushed = await sweep({
      worktreeState: async () => ({ dirty: 0, unpushed: 3 })
    })
    expect(unpushed.held).toEqual([
      { paneKey: 'tab-1:pane-1', sessionId: null, reason: 'unpushed' }
    ])
  })
})

describe('worker cleanup sweep: action', () => {
  const settings = {
    forkWorkerCleanup: true,
    forkWorkerCleanupAction: 'release'
  }

  it('releases a chat worker and keeps its tab, once', async () => {
    const memory = new WorkerCleanupMemory()
    const release = vi.fn(async () => true)
    const close = vi.fn(deps().close)
    const first = await sweep({ settings, release, close, chatSession: () => 'chat-1' }, memory)
    expect(first.items).toEqual([
      {
        kind: 'chat-released',
        worktreeId: 'repo-1::/work/wt-1',
        sessionId: 'chat-1',
        paneKey: 'tab-1:pane-1'
      }
    ])
    expect(close).not.toHaveBeenCalled()
    const second = await sweep({ settings, release, close, chatSession: () => 'chat-1' }, memory)
    expect(second.skipped.get('res-1')).toBe('released')
    expect(release).toHaveBeenCalledOnce()
  })

  it('reports nothing when the release did not happen', async () => {
    const result = await sweep({
      settings,
      release: async () => false,
      chatSession: () => 'chat-1'
    })
    expect(result.items).toEqual([])
  })

  it('still closes a terminal worker in release mode', async () => {
    const result = await sweep({ settings })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.kind).toBe('terminal-closed')
  })

  it('closes every due worker in one batch', async () => {
    const close = vi.fn(deps().close)
    const result = await sweep({
      close,
      candidates: [
        candidate(),
        candidate({ resourceId: 'res-2', terminalHandle: 'term-2' }),
        candidate({ resourceId: 'res-3', unreadReport: true })
      ]
    })
    expect(close).toHaveBeenCalledOnce()
    expect(result.items).toHaveLength(2)
  })
})
