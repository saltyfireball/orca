// SLRM-2394: branch clashes over throwaway git repos (the lost work sandbox: no global config).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseWorktreeList } from '../../../shared/git/worktrees/git-worktree-porcelain-parser'
import { buildForkClashes } from '../../../shared/fork/branch-clashes'
import { FORK_CLASHES_DEFAULT_BEHIND } from '../../../shared/fork/branch-clashes'
import { DISPATCH_STALE_THRESHOLD } from '../../runtime/orchestration/coordinator/dispatch/coordinator-stale-base-flag'
import {
  commitFile,
  createLostWorkRepo,
  createLostWorkSandbox,
  type LostWorkSandbox
} from '../lost-work/lost-work.test-fixture'
import type { LostWorkGit } from '../lost-work/lost-work-git'
import {
  ForkClashCache,
  scanClashRepo,
  type ClashRepo,
  type ClashScanDeps
} from './branch-clashes-git'

let sandbox: LostWorkSandbox
let repo: ClashRepo
let calls: string[][]

function deps(): ClashScanDeps {
  const git: LostWorkGit = (args, options) => {
    calls.push(args)
    return sandbox.git(args, options)
  }
  return {
    git,
    listWorktrees: async (r) =>
      parseWorktreeList(await sandbox.git(['worktree', 'list', '--porcelain'], { cwd: r.path }))
  }
}

async function addWorktree(name: string): Promise<string> {
  const path = join(sandbox.root, name)
  await sandbox.run(repo.path, 'worktree', 'add', '-q', '-b', name, path, 'main')
  return path
}

beforeEach(async () => {
  sandbox = await createLostWorkSandbox()
  repo = await createLostWorkRepo(sandbox)
  calls = []
})

afterEach(async () => {
  await sandbox.dispose()
})

describe('scanClashRepo', () => {
  it('uses the orchestrator stale-base threshold as the default', () => {
    expect(FORK_CLASHES_DEFAULT_BEHIND).toBe(DISPATCH_STALE_THRESHOLD)
  })

  it('finds a file two worktree branches commit, and skips the default branch', async () => {
    const a = await addWorktree('a')
    const b = await addWorktree('b')
    await commitFile(sandbox, a, 'shared.ts', 'a\n', 'a')
    await commitFile(sandbox, a, 'only-a.ts', 'a\n', 'a2')
    await commitFile(sandbox, b, 'shared.ts', 'b\n', 'b')
    const scanned = await scanClashRepo(deps(), repo, new ForkClashCache(), { uncommitted: false })
    expect(scanned.projectKey).toBeNull()
    expect(scanned.baseRef).toBe('origin/main')
    expect(
      scanned.branches.map((entry) => [entry.branch, entry.files.sort(), entry.ahead])
    ).toEqual([
      ['a', ['only-a.ts', 'shared.ts'], 2],
      ['b', ['shared.ts'], 1]
    ])
    const result = buildForkClashes(
      [{ hostId: 'local', hostName: 'this machine', status: 'ok', repos: [scanned] }],
      20,
      1
    )
    expect(result.projects[0].files.map((entry) => entry.file)).toEqual(['shared.ts'])
  })

  it('counts uncommitted and untracked files when asked', async () => {
    const a = await addWorktree('a')
    const b = await addWorktree('b')
    await writeFile(join(a, 'README.md'), 'edited\n')
    await writeFile(join(b, 'README.md'), 'edited too\n')
    await writeFile(join(b, 'new.txt'), 'new\n')
    const off = await scanClashRepo(deps(), repo, new ForkClashCache(), { uncommitted: false })
    expect(off.branches).toEqual([])
    const on = await scanClashRepo(deps(), repo, new ForkClashCache(), { uncommitted: true })
    expect(on.branches.map((entry) => [entry.branch, entry.files.sort()])).toEqual([
      ['a', ['README.md']],
      ['b', ['README.md', 'new.txt']]
    ])
  })

  it('leaves out files a squash merge already put on the default branch', async () => {
    const a = await addWorktree('a')
    await commitFile(sandbox, a, 'done.ts', 'same\n', 'work')
    await commitFile(sandbox, repo.path, 'done.ts', 'same\n', 'squash')
    await sandbox.run(repo.path, 'push', '-q', 'origin', 'main')
    const scanned = await scanClashRepo(deps(), repo, new ForkClashCache(), { uncommitted: false })
    expect(scanned.branches).toEqual([
      expect.objectContaining({ branch: 'a', files: [], ahead: 1, behind: 1 })
    ])
  })

  it('counts commits behind the default branch', async () => {
    await addWorktree('old')
    for (let i = 0; i < 3; i += 1) {
      await commitFile(sandbox, repo.path, `m${i}.ts`, `${i}\n`, `m${i}`)
    }
    await sandbox.run(repo.path, 'push', '-q', 'origin', 'main')
    const scanned = await scanClashRepo(deps(), repo, new ForkClashCache(), { uncommitted: false })
    expect(scanned.branches).toEqual([
      expect.objectContaining({ branch: 'old', behind: 3, ahead: 0 })
    ])
  })

  it('reads a branch once while its head and the base stay put', async () => {
    const a = await addWorktree('a')
    await commitFile(sandbox, a, 'x.ts', 'x\n', 'x')
    const cache = new ForkClashCache()
    await scanClashRepo(deps(), repo, cache, { uncommitted: false })
    const firstDiffs = calls.filter((args) => args[0] === 'diff' || args[0] === 'rev-list').length
    expect(firstDiffs).toBeGreaterThan(0)
    calls = []
    await scanClashRepo(deps(), repo, cache, { uncommitted: false })
    expect(calls.filter((args) => args[0] === 'diff' || args[0] === 'rev-list')).toEqual([])
    await commitFile(sandbox, a, 'y.ts', 'y\n', 'y')
    calls = []
    const moved = await scanClashRepo(deps(), repo, cache, { uncommitted: false })
    expect(calls.some((args) => args[0] === 'diff')).toBe(true)
    expect(moved.branches[0].files.sort()).toEqual(['x.ts', 'y.ts'])
  })

  it('names the project by its remote address', async () => {
    await sandbox.run(repo.path, 'remote', 'set-url', 'origin', 'git@github.com:Owner/Project.git')
    const scanned = await scanClashRepo(deps(), repo, new ForkClashCache(), { uncommitted: false })
    expect(scanned.projectKey).toBe('github.com/owner/project')
  })
})
