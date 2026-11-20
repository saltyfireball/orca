// The archive pass over fakes: what is removed, what is left and why, and what is never touched.
import { describe, expect, it, vi } from 'vitest'
import type { WorkerWorkspaceLanding } from '../../../shared/fork/worker-archive'
import type { WorkerWorkspaceRecord } from './worker-archive-query'
import {
  runWorkerArchivePass,
  type WorkerArchiveDeps,
  type WorkerArchiveWorktree
} from './worker-archive-cleanup'

const HOUR = 3_600_000
const NOW = 10 * HOUR

function record(
  id: string,
  over: Partial<WorkerWorkspaceRecord['dispatches'][number]> = {}
): WorkerWorkspaceRecord {
  return {
    worktreeId: id,
    created: { workerStartedAt: 1_000_000, released: true },
    dispatches: [
      {
        dispatchId: `d-${id}`,
        state: 'succeeded',
        finishedAtMs: 5 * HOUR,
        keptOpen: false,
        takenOver: false,
        paneKey: `pane-${id}`,
        terminalHandle: null,
        creatorSessionId: null,
        creatorPaneKey: null,
        ...over
      }
    ]
  }
}

function worktree(id: string, over: Partial<WorkerArchiveWorktree> = {}): WorkerArchiveWorktree {
  return {
    id,
    name: id,
    path: `/wt/${id}`,
    branch: id,
    createdAt: 500_000,
    isPinned: false,
    isMainWorktree: false,
    lastActivityAt: 0,
    ...over
  }
}

function setup(
  records: WorkerWorkspaceRecord[],
  worktrees: WorkerArchiveWorktree[],
  over: Partial<WorkerArchiveDeps> = {},
  landing: WorkerWorkspaceLanding = { dirtyFiles: 0, unlandedCommits: 0 }
) {
  const remove = vi.fn(async () => undefined)
  const deps: WorkerArchiveDeps = {
    settings: {},
    nowMs: NOW,
    records,
    worktree: (id) => worktrees.find((entry) => entry.id === id),
    turnStartedAt: () => undefined,
    focused: new Set(),
    botOf: () => null,
    landing: async () => landing,
    remove,
    ...over
  }
  return { deps, remove }
}

const auto = { mode: 'auto', dryRun: false } as const

describe('runWorkerArchivePass', () => {
  it('removes a due, clean workspace without force', async () => {
    const { deps, remove } = setup([record('a')], [worktree('a')])
    const { rows } = await runWorkerArchivePass(deps, auto)
    expect(rows).toMatchObject([{ worktreeId: 'a', outcome: 'remove' }])
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), false)
  })

  it('leaves a workspace inside the delay, and says when it is due', async () => {
    const { deps, remove } = setup([record('a', { finishedAtMs: 9 * HOUR })], [worktree('a')])
    const { rows, status } = await runWorkerArchivePass(deps, auto)
    expect(rows[0]).toMatchObject({ outcome: 'skip', reason: 'not-due' })
    expect(status[0]).toMatchObject({ reason: 'not-due', dueAtMs: 11 * HOUR })
    expect(remove).not.toHaveBeenCalled()
  })

  it('shows unmerged and uncommitted work as the reason and offers Remove anyway', async () => {
    const unmerged = setup(
      [record('a')],
      [worktree('a')],
      {},
      { dirtyFiles: 0, unlandedCommits: 2 }
    )
    const first = await runWorkerArchivePass(unmerged.deps, auto)
    expect(first.rows[0]).toMatchObject({
      outcome: 'skip',
      reason: 'unmerged-commits',
      unlandedCommits: 2,
      canForce: true
    })
    const dirty = setup([record('a')], [worktree('a')], {}, { dirtyFiles: 3, unlandedCommits: 0 })
    expect((await runWorkerArchivePass(dirty.deps, auto)).rows[0]).toMatchObject({
      reason: 'uncommitted-changes',
      dirtyFiles: 3
    })
    expect(unmerged.remove).not.toHaveBeenCalled()
    expect(dirty.remove).not.toHaveBeenCalled()
  })

  it('removes a confirmed workspace with force, and never a running worker', async () => {
    const blocked = setup([record('a')], [worktree('a')], {}, { dirtyFiles: 1, unlandedCommits: 1 })
    await runWorkerArchivePass(blocked.deps, { ...auto, mode: 'manual', force: new Set(['a']) })
    expect(blocked.remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), true)
    const running = setup([record('b', { state: 'ready' })], [worktree('b')])
    const { rows } = await runWorkerArchivePass(running.deps, {
      ...auto,
      mode: 'manual',
      force: new Set(['b'])
    })
    expect(rows[0]).toMatchObject({ reason: 'running', canForce: false })
    expect(running.remove).not.toHaveBeenCalled()
  })

  it('holds a kept, pinned, focused or used workspace', async () => {
    const cases: [
      WorkerWorkspaceRecord,
      WorkerArchiveWorktree,
      Partial<WorkerArchiveDeps>,
      string
    ][] = [
      [record('k', { keptOpen: true }), worktree('k'), {}, 'kept-open'],
      [record('p'), worktree('p', { isPinned: true }), {}, 'pinned'],
      [record('f'), worktree('f'), { focused: new Set(['f']) }, 'focused'],
      [record('t'), worktree('t'), { turnStartedAt: () => 8 * HOUR }, 'used-after-done'],
      [record('l'), worktree('l', { lastActivityAt: 8 * HOUR }), {}, 'used-after-done']
    ]
    for (const [rec, wt, over, reason] of cases) {
      const { deps, remove } = setup([rec], [wt], over)
      const { rows } = await runWorkerArchivePass(deps, auto)
      expect(rows[0]).toMatchObject({ outcome: 'skip', reason })
      expect(remove).not.toHaveBeenCalled()
    }
  })

  it('never touches a workspace a worker did not create or that is not the worker', async () => {
    const lateReuse = worktree('r', { createdAt: 2_000_000 })
    const main = worktree('m', { isMainWorktree: true })
    const unknownAge = worktree('u', { createdAt: undefined })
    const { deps, remove } = setup(
      [record('r'), record('m'), record('u'), record('gone')],
      [lateReuse, main, unknownAge]
    )
    const { rows } = await runWorkerArchivePass(deps, auto)
    expect(rows).toEqual([])
    expect(remove).not.toHaveBeenCalled()
  })

  it('leaves a project on another host, or a folder, alone', async () => {
    const { deps, remove } = setup(
      [record('x')],
      [worktree('x', { unsupported: 'remote-project' })]
    )
    const { rows } = await runWorkerArchivePass(deps, auto)
    expect(rows[0]).toMatchObject({ reason: 'remote-project', canForce: false })
    expect(remove).not.toHaveBeenCalled()
  })

  it('a manual cleanup waives the delay; a dry run removes nothing', async () => {
    const fresh = record('a', { finishedAtMs: 9 * HOUR })
    const manual = setup([fresh], [worktree('a')])
    await runWorkerArchivePass(manual.deps, { mode: 'manual', dryRun: false })
    expect(manual.remove).toHaveBeenCalledTimes(1)
    const dry = setup([fresh], [worktree('a')])
    const { rows } = await runWorkerArchivePass(dry.deps, { mode: 'manual', dryRun: true })
    expect(rows[0]).toMatchObject({ outcome: 'remove' })
    expect(dry.remove).not.toHaveBeenCalled()
  })

  it('limits a bot cleanup to that bot, and reports a failed removal', async () => {
    const botOf = (rec: WorkerWorkspaceRecord) =>
      rec.worktreeId === 'a' ? { id: 'b1', name: 'Cassandra' } : null
    const failing = setup([record('a'), record('b')], [worktree('a'), worktree('b')], { botOf })
    failing.remove.mockRejectedValueOnce(new Error('pty stop not proven'))
    const { rows } = await runWorkerArchivePass(failing.deps, { ...auto, bot: 'cassandra' })
    expect(rows).toMatchObject([
      { worktreeId: 'a', botName: 'Cassandra', outcome: 'failed', error: 'pty stop not proven' }
    ])
  })
})
