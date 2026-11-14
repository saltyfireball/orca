// SLRM-2175: the lost work scan's one-read-per-repository path gives the answers the per-branch
// path gives, on current git and on git too old for `ahead-behind`; projects that share a
// repository are read once; pull requests are read beside the git work, with a time limit.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveLostWorkSettings, type LostWorkScanProgress } from '../../../shared/fork/lost-work'
import { countUnpushedInGraph } from './lost-work-batch'
import type { LostWorkGit } from './lost-work-git'
import { scanLostWork, type LostWorkRepo } from './lost-work-scan'
import {
  commitFile,
  createLostWorkRepo,
  createLostWorkSandbox,
  lostWorkTestDeps,
  type LostWorkSandbox
} from './lost-work.test-fixture'

let sandbox: LostWorkSandbox

beforeEach(async () => {
  sandbox = await createLostWorkSandbox()
})

afterEach(async () => {
  await sandbox.dispose()
})

const settings = resolveLostWorkSettings(undefined)

async function addWorktree(repoPath: string, branch: string): Promise<string> {
  const path = join(sandbox.root, `wt-${branch}`)
  await sandbox.run(repoPath, 'worktree', 'add', '-q', '-b', branch, path, 'main')
  return path
}

/** The sandbox's git, counting calls and failing those `refuse` names, as an older git would. */
function countingGit(refuse: (args: string[]) => boolean = () => false) {
  const calls: string[][] = []
  const git: LostWorkGit = (args, options) => {
    calls.push(args)
    return refuse(args)
      ? Promise.reject(new Error(`git ${args[0]}: unknown option`))
      : sandbox.git(args, options)
  }
  return { git, calls, count: (command: string) => calls.filter((c) => c[0] === command).length }
}

const noAheadBehind = (args: string[]) => args.some((arg) => arg.includes('ahead-behind'))
const noBatchAtAll = (args: string[]) =>
  noAheadBehind(args) ||
  args.some((arg) => arg.startsWith('--merged')) ||
  (args[0] === 'rev-list' && args.includes('--parents'))

/** Merged, patch-equivalent, squashed, pushed, unpushed and detached work in one repository. */
async function buildRepository(): Promise<{ repo: LostWorkRepo; tracked: Set<string> }> {
  const repo = await createLostWorkRepo(sandbox)
  const tracked = new Set<string>()
  const worktree = async (branch: string) => {
    const path = await addWorktree(repo.path, branch)
    tracked.add(`${repo.id}::${path}`)
    return path
  }
  // Branches that never left main: the fast path drops them without asking git about each.
  for (const name of ['idle-1', 'idle-2', 'idle-3']) {
    await sandbox.run(repo.path, 'branch', name, 'main')
  }
  await worktree('idle-tree')
  const merged = await worktree('merged')
  await commitFile(sandbox, merged, 'merged.txt', 'm\n', 'merged work')
  await sandbox.run(repo.path, 'merge', '-q', '--no-ff', '-m', 'merge', 'merged')
  // Ahead of main by commit id, but the same change is on main: `git cherry` calls it merged.
  const picked = await worktree('picked')
  const pickedHead = await commitFile(sandbox, picked, 'picked.txt', 'p\n', 'picked work')
  // Main moves first, so the picked commit gets a new id rather than the same one.
  await commitFile(sandbox, repo.path, 'main-only.txt', 'm\n', 'main moves on')
  await sandbox.run(repo.path, 'cherry-pick', pickedHead)
  const squashed = await worktree('squashed')
  await commitFile(sandbox, squashed, 'squash.txt', 'one\n', 'squash one')
  await commitFile(sandbox, squashed, 'squash.txt', 'one\ntwo\n', 'squash two')
  await sandbox.run(repo.path, 'merge', '-q', '--squash', 'squashed')
  await sandbox.run(repo.path, 'commit', '-q', '-m', 'squashed in')
  await sandbox.run(repo.path, 'push', '-q', 'origin', 'main')
  const feature = await worktree('feature')
  await commitFile(sandbox, feature, 'feature.txt', 'f\n', 'feature one')
  await commitFile(sandbox, feature, 'feature.txt', 'f\ng\n', 'feature two')
  // Pushed with an upstream that is level, then one more commit that is not pushed.
  const pushed = await worktree('pushed')
  await commitFile(sandbox, pushed, 'pushed.txt', 'p\n', 'pushed work')
  await sandbox.run(pushed, 'push', '-q', '-u', 'origin', 'pushed')
  const level = await worktree('level')
  await commitFile(sandbox, level, 'level.txt', 'l\n', 'level work')
  await sandbox.run(level, 'push', '-q', '-u', 'origin', 'level')
  await commitFile(sandbox, pushed, 'pushed.txt', 'p\nq\n', 'not pushed yet')
  const detached = await worktree('detached-tmp')
  await commitFile(sandbox, detached, 'detached.txt', 'd\n', 'detached work')
  await sandbox.run(detached, 'checkout', '-q', '--detach')
  await sandbox.run(repo.path, 'branch', '-D', 'detached-tmp')
  // A branch with work and no worktree.
  const lonely = await addWorktree(repo.path, 'lonely')
  await commitFile(sandbox, lonely, 'lonely.txt', 'l\n', 'lonely work')
  await sandbox.run(repo.path, 'worktree', 'remove', '--force', lonely)
  return { repo, tracked }
}

// Each case spawns dozens of real git processes, slow when other test files run beside it.
describe('scanLostWork batched reads', { timeout: 60_000 }, () => {
  it('gives the same items from one read, from old git and from per-branch reads', async () => {
    const { repo, tracked } = await buildRepository()
    const scan = (git: LostWorkGit) =>
      scanLostWork([repo], settings, { ...lostWorkTestDeps(sandbox, tracked), git })
    const fast = countingGit()
    const oldGit = countingGit(noAheadBehind)
    const perBranch = countingGit(noBatchAtAll)
    const fastResult = await scan(fast.git)
    expect((await scan(oldGit.git)).items).toEqual(fastResult.items)
    expect((await scan(perBranch.git)).items).toEqual(fastResult.items)

    const byBranch = (name: string) => fastResult.items.find((item) => item.branch === name)
    expect(byBranch('idle-tree')).toMatchObject({ unmergedCommits: 0, reasons: ['merged'] })
    expect(byBranch('merged')).toMatchObject({ unmergedCommits: 0, reasons: ['merged'] })
    expect(byBranch('picked')).toMatchObject({ risk: 'safe', unmergedCommits: 0 })
    expect(byBranch('squashed')).toMatchObject({ unmergedCommits: 0, reasons: ['squash-merged'] })
    expect(byBranch('feature')).toMatchObject({ unmergedCommits: 2, unpushedCommits: 2 })
    expect(byBranch('pushed')).toMatchObject({ unmergedCommits: 2, unpushedCommits: 1 })
    expect(byBranch('level')).toMatchObject({ unmergedCommits: 1, unpushedCommits: 0 })
    expect(byBranch('lonely')).toMatchObject({ kind: 'branch', unmergedCommits: 1 })
    expect(byBranch('idle-1')).toBeUndefined()
    const detached = fastResult.items.find((item) => item.branch === null)
    expect(detached).toMatchObject({ unmergedCommits: 1, unpushedCommits: 1 })
    expect(detached?.reasons).toContain('detached-head')
    expect(fastResult.items.every((item) => typeof item.lastCommitAt === 'number')).toBe(true)

    // One cherry per tip that is ahead of main (picked, squashed, feature, pushed, level, the
    // detached worktree and lonely): the merged and idle ones cost nothing.
    expect(fast.count('cherry')).toBe(7)
    expect(oldGit.count('cherry')).toBe(7)
    // Every branch and worktree but main: what the scan asked before it read refs in one call.
    expect(perBranch.count('cherry')).toBe(12)
    // Unpushed counts come from one graph read. Commit dates come with the refs: the only `log`
    // calls left are the detached tip's date and the base's patches for the squash check.
    expect(fast.count('rev-list')).toBe(1)
    expect(fast.count('log')).toBe(2)
    expect(perBranch.count('rev-list')).toBeGreaterThan(10)
  })

  it('reads projects of one repository once and lists each item under one project', async () => {
    const repo = await createLostWorkRepo(sandbox)
    const sidePath = await addWorktree(repo.path, 'side')
    await commitFile(sandbox, sidePath, 'side.txt', 's\n', 'side work')
    const otherPath = await addWorktree(repo.path, 'other')
    await commitFile(sandbox, otherPath, 'other.txt', 'o\n', 'other work')
    const lonely = await addWorktree(repo.path, 'lonely')
    await commitFile(sandbox, lonely, 'lonely.txt', 'l\n', 'lonely work')
    await sandbox.run(repo.path, 'worktree', 'remove', '--force', lonely)
    await writeFile(join(repo.path, 'README.md'), 'stashed change\n')
    await sandbox.run(repo.path, 'stash', 'push', '-q', '-m', 'keep me')
    const second = await createLostWorkRepo(sandbox, 'second')

    // The worktree is opened as a project of its own, and listed before the main checkout.
    const side: LostWorkRepo = { id: 'repo-side', name: 'side', path: sidePath }
    const tracked = new Set([`${repo.id}::${otherPath}`, `${side.id}::${sidePath}`])
    const counted = countingGit()
    let lookups = 0
    const progress: LostWorkScanProgress[] = []
    const result = await scanLostWork(
      [side, repo, second],
      settings,
      {
        ...lostWorkTestDeps(sandbox, tracked),
        git: counted.git,
        lookupPullRequests: async () => {
          lookups += 1
          return new Map()
        }
      },
      undefined,
      [],
      { onProgress: (event) => progress.push(event) }
    )

    expect(new Set(result.items.map((item) => item.id)).size).toBe(result.items.length)
    const owner = (match: (typeof result.items)[number] | undefined) =>
      match ? `${match.repoId} ${match.kind}` : 'none'
    expect(owner(result.items.find((item) => item.path === sidePath))).toBe('repo-side worktree')
    expect(owner(result.items.find((item) => item.path === otherPath))).toBe(`${repo.id} worktree`)
    expect(owner(result.items.find((item) => item.branch === 'lonely'))).toBe(`${repo.id} branch`)
    expect(owner(result.items.find((item) => item.kind === 'stash'))).toBe(`${repo.id} stash`)
    expect(result.items).toHaveLength(4)
    expect(result.notes).toEqual([
      { repoId: 'repo-side', repoName: 'side', code: 'shared-repository', detail: repo.name }
    ])
    // Two repositories, three projects: one pull request read and one ref read for each.
    expect(lookups).toBe(2)
    expect(counted.count('for-each-ref')).toBe(2)
    expect(counted.count('stash')).toBe(2)

    expect(progress[0]).toMatchObject({ done: 0, total: 3 })
    const finished = progress.flatMap((event) => (event.finished ? [event.finished] : []))
    expect(finished.map((entry) => entry.repoIds).sort()).toEqual(
      [['repo-side', repo.id], [second.id]].sort()
    )
    expect(
      finished
        .flatMap((entry) => entry.items)
        .map((item) => item.id)
        .sort()
    ).toEqual(result.items.map((item) => item.id).sort())
    expect(progress.at(-1)).toMatchObject({ done: 3, total: 3, current: [] })
  })

  it('reads pull requests beside the git work and gives up when the time limit passes', async () => {
    const repo = await createLostWorkRepo(sandbox)
    const path = await addWorktree(repo.path, 'topic')
    await commitFile(sandbox, path, 't.txt', 't\n', 'topic work')
    const tracked = new Set([`${repo.id}::${path}`])

    // The lookup only answers once git has read the refs: a scan that waited for pull requests
    // before any git work would never finish.
    let refsRead: () => void = () => {}
    const afterRefs = new Promise<void>((resolve) => (refsRead = resolve))
    const git: LostWorkGit = (args, options) => {
      if (args[0] === 'for-each-ref') {
        refsRead()
      }
      return sandbox.git(args, options)
    }
    const beside = await scanLostWork([repo], settings, {
      ...lostWorkTestDeps(sandbox, tracked),
      git,
      lookupPullRequests: async () => {
        await afterRefs
        return new Map([
          [
            'topic',
            {
              number: 3,
              state: 'open',
              url: 'https://example.test/pr/3',
              headOid: '',
              updatedAt: 0
            }
          ]
        ])
      }
    })
    expect(beside.items[0]).toMatchObject({ branch: 'topic', pullRequest: { number: 3 } })
    expect(beside.notes).toEqual([])

    let stopped = false
    const slow = await scanLostWork(
      [repo],
      resolveLostWorkSettings({ pullRequestTimeoutSeconds: 1 }),
      {
        ...lostWorkTestDeps(sandbox, tracked),
        lookupPullRequests: (_repo, _limit, signal) =>
          new Promise(() => {
            signal?.addEventListener('abort', () => (stopped = true))
          })
      }
    )
    expect(slow.items[0]).toMatchObject({ branch: 'topic', unmergedCommits: 1 })
    expect(slow.items[0].pullRequest).toBeUndefined()
    expect(slow.notes).toEqual([
      { repoId: repo.id, repoName: repo.name, code: 'pull-requests-unavailable' }
    ])
    expect(stopped).toBe(true)
  })
})

describe('countUnpushedInGraph', () => {
  it('counts the commits a tip can reach inside the graph, once each', () => {
    // d merges b and c, which both follow a; x is on a remote, so it is not in the graph.
    const graph = new Map([
      ['a', ['x']],
      ['b', ['a']],
      ['c', ['a']],
      ['d', ['b', 'c']]
    ])
    expect(countUnpushedInGraph(graph, 'd')).toBe(4)
    expect(countUnpushedInGraph(graph, 'b')).toBe(2)
    expect(countUnpushedInGraph(graph, 'x')).toBe(0)
  })
})
