// Worker cleanup's git checks over throwaway repos (the lost work sandbox), with gh faked.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commitFile,
  createLostWorkRepo,
  createLostWorkSandbox,
  type LostWorkSandbox
} from '../lost-work/lost-work.test-fixture'
import {
  isWorkerBranchMerged,
  readWorkerWorktreeState,
  type WorkerCleanupGh
} from './worker-cleanup-git'

let sandbox: LostWorkSandbox
let repoPath: string

beforeEach(async () => {
  sandbox = await createLostWorkSandbox()
  repoPath = (await createLostWorkRepo(sandbox)).path
})

afterEach(async () => {
  await sandbox.dispose()
})

async function addWorktree(branch: string): Promise<string> {
  const path = join(sandbox.root, `wt-${branch}`)
  await sandbox.run(repoPath, 'worktree', 'add', '-q', '-b', branch, path, 'main')
  return path
}

describe('readWorkerWorktreeState', () => {
  it('reads a clean, pushed worktree as nothing held', async () => {
    const path = await addWorktree('clean')
    expect(await readWorkerWorktreeState(sandbox.git, path)).toEqual({
      dirty: 0,
      unpushed: 0
    })
  })

  it('counts uncommitted files and unpushed commits', async () => {
    const path = await addWorktree('busy')
    await commitFile(sandbox, path, 'a.txt', 'a\n', 'a')
    await writeFile(join(path, 'b.txt'), 'b\n')
    expect(await readWorkerWorktreeState(sandbox.git, path)).toEqual({
      dirty: 1,
      unpushed: 1
    })
  })

  it('reads an unknown folder as unknown', async () => {
    const state = await readWorkerWorktreeState(sandbox.git, join(sandbox.root, 'missing'))
    expect(state.dirty).toBeNull()
  })
})

describe('isWorkerBranchMerged', () => {
  it('reads a branch with no commits of its own as not merged', async () => {
    const path = await addWorktree('idle')
    expect(await isWorkerBranchMerged(sandbox.git, null, path)).toBe(false)
  })

  it('reads a branch with work not on main as not merged', async () => {
    const path = await addWorktree('open')
    await commitFile(sandbox, path, 'a.txt', 'a\n', 'a')
    expect(await isWorkerBranchMerged(sandbox.git, null, path)).toBe(false)
  })

  it('reads a branch whose commits all reached the default branch as merged', async () => {
    const path = await addWorktree('landed')
    await commitFile(sandbox, path, 'a.txt', 'a\n', 'a')
    await sandbox.run(repoPath, 'merge', '-q', '--ff-only', 'landed')
    await sandbox.run(repoPath, 'push', '-q', 'origin', 'main')
    await sandbox.run(path, 'fetch', '-q', 'origin')
    expect(await isWorkerBranchMerged(sandbox.git, null, path)).toBe(true)
  })

  it('takes a merged pull request from gh, and degrades quietly when gh fails', async () => {
    const path = await addWorktree('pr')
    await commitFile(sandbox, path, 'a.txt', 'a\n', 'a')
    const merged = vi.fn<WorkerCleanupGh>(async () => '[{"number":7}]')
    expect(await isWorkerBranchMerged(sandbox.git, merged, path)).toBe(true)
    expect(merged.mock.calls[0]?.[0]).toEqual([
      'pr',
      'list',
      '--head',
      'pr',
      '--state',
      'merged',
      '--json',
      'number',
      '--limit',
      '1'
    ])
    expect(await isWorkerBranchMerged(sandbox.git, async () => '[]', path)).toBe(false)
    const signedOut = async (): Promise<string> => {
      throw new Error('not signed in')
    }
    expect(await isWorkerBranchMerged(sandbox.git, signedOut, path)).toBe(false)
  })

  it('never asks gh about the default branch itself', async () => {
    const gh = vi.fn(async () => '[{"number":1}]')
    expect(await isWorkerBranchMerged(sandbox.git, gh, repoPath)).toBe(false)
    expect(gh).not.toHaveBeenCalled()
  })
})
