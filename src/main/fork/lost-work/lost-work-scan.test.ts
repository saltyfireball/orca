// SLRM-2096: the lost work scan over throwaway repos, one per case.
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveLostWorkSettings, type LostWorkItem } from '../../../shared/fork/lost-work'
import { scanLostWork } from './lost-work-scan'
import {
  commitFile,
  createLostWorkRepo,
  createLostWorkSandbox,
  lostWorkTestDeps,
  type LostWorkSandbox
} from './lost-work.test-fixture'
import type { LostWorkPullRequestMap } from './lost-work-pull-requests'

let sandbox: LostWorkSandbox

beforeEach(async () => {
  sandbox = await createLostWorkSandbox()
})

afterEach(async () => {
  await sandbox.dispose()
})

async function addWorktree(repoPath: string, branch: string): Promise<string> {
  const path = join(sandbox.root, `wt-${branch}`)
  await sandbox.run(repoPath, 'worktree', 'add', '-q', '-b', branch, path, 'main')
  return path
}

function byBranch(items: LostWorkItem[], branch: string): LostWorkItem | undefined {
  return items.find((item) => item.branch === branch)
}

const settings = resolveLostWorkSettings(undefined)

// Each case spawns dozens of real git processes, slow when other test files run beside it.
describe('scanLostWork', { timeout: 30_000 }, () => {
  it('sorts merged, squash-merged, unmerged, untracked, missing, branch and stash cases', async () => {
    const repo = await createLostWorkRepo(sandbox)
    const tracked = new Set<string>()
    const track = (path: string) => tracked.add(`${repo.id}::${path}`)

    // Merged with a merge commit.
    const merged = await addWorktree(repo.path, 'merged')
    track(merged)
    await commitFile(sandbox, merged, 'merged.txt', 'm\n', 'merged work')
    await sandbox.run(repo.path, 'merge', '-q', '--no-ff', '-m', 'merge', 'merged')

    // Squash-merged: two commits that land on main as one.
    const squashed = await addWorktree(repo.path, 'squashed')
    track(squashed)
    await commitFile(sandbox, squashed, 'squash.txt', 'one\n', 'squash one')
    await commitFile(sandbox, squashed, 'squash.txt', 'one\ntwo\n', 'squash two')
    await sandbox.run(repo.path, 'merge', '-q', '--squash', 'squashed')
    await sandbox.run(repo.path, 'commit', '-q', '-m', 'squashed in')
    await sandbox.run(repo.path, 'push', '-q', 'origin', 'main')

    // Unmerged, on no remote, with an uncommitted file.
    const feature = await addWorktree(repo.path, 'feature')
    track(feature)
    await commitFile(sandbox, feature, 'feature.txt', 'f\n', 'feature work')
    await writeFile(join(feature, 'scratch.txt'), 'dirty\n')

    // Unmerged but pushed.
    const pushed = await addWorktree(repo.path, 'pushed')
    track(pushed)
    await commitFile(sandbox, pushed, 'pushed.txt', 'p\n', 'pushed work')
    await sandbox.run(pushed, 'push', '-q', 'origin', 'pushed')

    // A worktree Orca does not track.
    await addWorktree(repo.path, 'orphan')

    // A worktree whose folder is gone.
    const gone = await addWorktree(repo.path, 'gone')
    track(gone)
    await rm(gone, { recursive: true, force: true })

    // A branch with unmerged work and no worktree, and a fully merged one that is not listed.
    await sandbox.run(repo.path, 'branch', 'lonely', 'main')
    await sandbox.run(repo.path, 'branch', 'done', 'main')
    const lonelyTree = await addWorktree(repo.path, 'lonely-tmp')
    await sandbox.run(lonelyTree, 'checkout', '-q', 'lonely')
    await commitFile(sandbox, lonelyTree, 'lonely.txt', 'l\n', 'lonely work')
    await sandbox.run(repo.path, 'worktree', 'remove', '--force', lonelyTree)
    await sandbox.run(repo.path, 'branch', '-D', 'lonely-tmp')

    // A stash in the main checkout.
    await writeFile(join(repo.path, 'README.md'), 'stashed change\n')
    await sandbox.run(repo.path, 'stash', 'push', '-q', '-m', 'keep me')

    const result = await scanLostWork([repo], settings, {
      ...lostWorkTestDeps(sandbox, tracked),
      lookupPullRequests: async () => null
    })

    expect(byBranch(result.items, 'merged')).toMatchObject({
      kind: 'worktree',
      risk: 'safe',
      unmergedCommits: 0,
      reasons: ['merged']
    })
    expect(byBranch(result.items, 'squashed')).toMatchObject({
      kind: 'worktree',
      risk: 'safe',
      unmergedCommits: 0,
      reasons: ['squash-merged']
    })
    expect(byBranch(result.items, 'feature')).toMatchObject({
      kind: 'worktree',
      risk: 'would-lose-work',
      unmergedCommits: 1,
      unpushedCommits: 1,
      dirtyFiles: 1,
      baseRef: 'origin/main'
    })
    expect(byBranch(result.items, 'feature')?.reasons).toEqual([
      'unmerged-commits',
      'unpushed-commits',
      'dirty-files'
    ])
    expect(byBranch(result.items, 'pushed')).toMatchObject({
      risk: 'needs-look',
      unmergedCommits: 1,
      unpushedCommits: 0
    })
    expect(byBranch(result.items, 'orphan')).toMatchObject({
      kind: 'untracked-worktree',
      reasons: ['not-tracked', 'merged']
    })
    expect(byBranch(result.items, 'gone')).toMatchObject({ kind: 'missing-folder', risk: 'safe' })
    expect(byBranch(result.items, 'lonely')).toMatchObject({
      kind: 'branch',
      risk: 'would-lose-work',
      unmergedCommits: 1
    })
    expect(byBranch(result.items, 'done')).toBeUndefined()
    expect(byBranch(result.items, 'main')).toBeUndefined()
    const stash = result.items.find((item) => item.kind === 'stash')
    expect(stash).toMatchObject({ risk: 'would-lose-work', stash: { index: 0 } })
    expect(stash?.stash?.message).toContain('keep me')
    expect(result.notes).toEqual([
      { repoId: repo.id, repoName: repo.name, code: 'pull-requests-unavailable' }
    ])
  })

  it('treats a branch whose pull request merged as finished, and reads nothing when checks are off', async () => {
    const repo = await createLostWorkRepo(sandbox)
    const path = await addWorktree(repo.path, 'reviewed')
    const head = await commitFile(sandbox, path, 'r.txt', 'r\n', 'reviewed work')
    await sandbox.run(path, 'push', '-q', 'origin', 'reviewed')
    const tracked = new Set([`${repo.id}::${path}`])
    const pullRequests: LostWorkPullRequestMap = new Map([
      [
        'reviewed',
        {
          number: 7,
          state: 'merged',
          url: 'https://example.test/pr/7',
          headOid: head,
          updatedAt: 0
        }
      ]
    ])
    const result = await scanLostWork([repo], settings, {
      ...lostWorkTestDeps(sandbox, tracked),
      lookupPullRequests: async () => pullRequests
    })
    expect(byBranch(result.items, 'reviewed')).toMatchObject({
      risk: 'safe',
      unmergedCommits: 0,
      reasons: ['pr-merged'],
      pullRequest: { number: 7, state: 'merged' }
    })

    const off = resolveLostWorkSettings({
      checks: {
        unmergedWorktrees: false,
        finishedWorktrees: false,
        untrackedWorktrees: false,
        missingFolders: false,
        unmergedBranches: false,
        stashes: false,
        pullRequests: false
      }
    })
    let asked = false
    const none = await scanLostWork([repo], off, {
      ...lostWorkTestDeps(sandbox, tracked),
      lookupPullRequests: async () => {
        asked = true
        return null
      }
    })
    expect(none.items).toEqual([])
    expect(asked).toBe(false)
  })

  it('uses a per-project default branch and notes a project without one', async () => {
    const repo = await createLostWorkRepo(sandbox)
    await sandbox.run(repo.path, 'branch', 'release', 'main')
    const path = await addWorktree(repo.path, 'topic')
    await commitFile(sandbox, path, 't.txt', 't\n', 'topic work')
    // Merged into the custom base only.
    await sandbox.run(repo.path, 'branch', '-f', 'release', 'topic')
    const custom = resolveLostWorkSettings({ defaultBranches: { [repo.id]: 'release' } })
    const result = await scanLostWork([repo], custom, lostWorkTestDeps(sandbox, new Set()))
    expect(byBranch(result.items, 'topic')).toMatchObject({
      baseRef: 'release',
      unmergedCommits: 0
    })

    const missing = resolveLostWorkSettings({ defaultBranches: { [repo.id]: 'nope' } })
    const noted = await scanLostWork([repo], missing, lostWorkTestDeps(sandbox, new Set()))
    expect(noted.notes).toContainEqual({
      repoId: repo.id,
      repoName: repo.name,
      code: 'no-default-branch',
      detail: 'nope'
    })
    expect(byBranch(noted.items, 'topic')).toMatchObject({
      risk: 'needs-look',
      unmergedCommits: null
    })
  })

  it('stops when cancelled', async () => {
    const repo = await createLostWorkRepo(sandbox)
    const controller = new AbortController()
    controller.abort()
    await expect(
      scanLostWork([repo], settings, lostWorkTestDeps(sandbox, new Set()), controller.signal)
    ).rejects.toThrow(/cancel/i)
  })
})
