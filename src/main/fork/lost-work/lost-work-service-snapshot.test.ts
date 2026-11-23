// BAD-767: Lost work's delete of a worktree Orca does not track, run through the service the
// desktop and `orca serve` use, over real git in a temp repo. Nothing but git's own binary and
// config is replaced: the snapshot comes from the real snapshot service.
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseWorktreeList } from '../../../shared/git/worktrees/git-worktree-porcelain-parser'
import type { LostWorkItem } from '../../../shared/fork/lost-work'
import type { Store } from '../../persistence/loading-store/store'
import { restoreWorktreeSnapshot } from '../worktree-snapshots/worktree-snapshot-git'
import {
  commitFile,
  createLostWorkRepo,
  createLostWorkSandbox,
  snapshotGitOf,
  type LostWorkSandbox
} from './lost-work.test-fixture'

const env = vi.hoisted(() => ({
  run: null as null | ((args: string[], cwd: string, stdin?: string) => Promise<string>),
  failSnapshotWrite: false
}))
vi.mock('../../git/command-runner/git-exec-file', () => ({
  gitExecFileAsync: async (
    args: string[],
    options: { cwd: string; stdin?: string; env?: Record<string, string> }
  ) => {
    if (env.failSnapshotWrite && args[0] === 'update-ref') {
      throw new Error('no space left on device')
    }
    const run = env.run
    if (!run) {
      throw new Error('no sandbox')
    }
    return { stdout: await run(args, options.cwd, options.stdin), stderr: '' }
  }
}))
vi.mock('../../ipc/workspace-cleanup/workspace-cleanup-worktree-listing', () => ({
  listCleanupGitWorktrees: async (_store: unknown, repo: { path: string }) => ({
    route: { kind: 'local' },
    gitWorktrees: parseWorktreeList(await env.run!(['worktree', 'list', '--porcelain'], repo.path))
  })
}))

const { runForkLostWorkAction } = await import('./lost-work-service')
const { installForkWorktreeSnapshots } =
  await import('../worktree-snapshots/worktree-snapshot-service')

let sandbox: LostWorkSandbox
let repoPath: string

beforeEach(async () => {
  sandbox = await createLostWorkSandbox()
  repoPath = (await createLostWorkRepo(sandbox)).path
  const git = snapshotGitOf(sandbox)
  env.run = (args, cwd, stdin) => git(args, { cwd, ...(stdin !== undefined ? { stdin } : {}) })
  env.failSnapshotWrite = false
  installForkWorktreeSnapshots({ getSettings: () => ({}) })
})

afterEach(async () => {
  env.run = null
  await sandbox.dispose()
})

function store(): Store {
  return {
    getRepos: () => [{ id: 'repo-project', path: repoPath, displayName: 'project' }],
    getWorktreeMeta: () => undefined,
    getSettings: () => ({})
  } as unknown as Store
}

function item(path: string, over: Partial<LostWorkItem> = {}): LostWorkItem {
  return {
    id: 'x',
    kind: 'untracked-worktree',
    risk: 'would-lose-work',
    reasons: [],
    repoId: 'repo-project',
    repoName: 'project',
    path,
    baseRef: 'origin/main',
    unmergedCommits: null,
    unpushedCommits: null,
    dirtyFiles: null,
    lastCommitAt: null,
    ...over
  }
}

const remove = (path: string, over: Partial<LostWorkItem> = {}) =>
  runForkLostWorkAction(store(), {
    action: 'remove-untracked-worktree',
    item: item(path, over),
    confirmedLoss: true
  })

async function snapshotsOf(): Promise<string[]> {
  const refs = await sandbox.run(
    repoPath,
    'for-each-ref',
    '--format=%(refname)',
    'refs/orca/snapshots'
  )
  return refs.split('\n').filter(Boolean)
}

describe('Lost work delete of an untracked worktree, through the service', () => {
  it('leaves a snapshot of dirty work that restores it', async () => {
    const path = join(sandbox.root, 'wt-dirty')
    await sandbox.run(repoPath, 'worktree', 'add', '-q', '-b', 'dirty', path, 'main')
    await writeFile(join(path, 'notes.txt'), 'unsaved\n')
    expect(await remove(path, { branch: 'dirty' })).toEqual({ ok: true })
    expect(existsSync(path)).toBe(false)
    expect(await snapshotsOf()).toHaveLength(1)
  })

  it('leaves a snapshot of a clean detached worktree whose commit is on no branch', async () => {
    const path = join(sandbox.root, 'wt-detached')
    await sandbox.run(repoPath, 'worktree', 'add', '-q', '--detach', path, 'main')
    const commit = await commitFile(sandbox, path, 'only-here.txt', 'kept\n', 'work on no branch')
    expect(await sandbox.run(path, 'status', '--porcelain')).toBe('')
    expect(await remove(path, { branch: undefined, head: commit })).toEqual({ ok: true })
    expect(existsSync(path)).toBe(false)
    const refs = await snapshotsOf()
    expect(refs).toHaveLength(1)
    const { listForkWorktreeSnapshots } =
      await import('../worktree-snapshots/worktree-snapshot-service')
    const { snapshots } = await listForkWorktreeSnapshots({
      getRepos: () => [{ id: 'repo-project', path: repoPath, displayName: 'project' }]
    } as never)
    expect(snapshots).toHaveLength(1)
    const target = join(sandbox.root, 'restored')
    await restoreWorktreeSnapshot(snapshotGitOf(sandbox), repoPath, snapshots[0], target)
    expect(await readFile(join(target, 'only-here.txt'), 'utf8')).toBe('kept\n')
  })

  it('removes nothing when the snapshot cannot be written, and says what to do instead of forcing', async () => {
    const path = join(sandbox.root, 'wt-nospace')
    await sandbox.run(repoPath, 'worktree', 'add', '-q', '-b', 'nospace', path, 'main')
    await writeFile(join(path, 'notes.txt'), 'unsaved\n')
    env.failSnapshotWrite = true
    const result = await remove(path, { branch: 'nospace' })
    expect(result).toMatchObject({ ok: false })
    const error = (result as { error: string }).error
    expect(error).toContain('no space left on device')
    expect(error).toMatch(/free some disk space/i)
    expect(error).toMatch(/git worktree remove --force/)
    expect(error).not.toMatch(/Force the delete/)
    expect(existsSync(path)).toBe(true)
  })
})
