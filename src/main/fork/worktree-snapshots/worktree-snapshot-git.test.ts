// Worktree snapshots over throwaway repos (the lost work sandbox): create, restore, prune.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  commitFile,
  createLostWorkRepo,
  createLostWorkSandbox,
  type LostWorkSandbox
} from '../lost-work/lost-work.test-fixture'
import {
  createWorktreeSnapshot,
  listWorktreeSnapshots,
  pruneWorktreeSnapshots,
  restoreWorktreeSnapshot,
  snapshotWorkspaceName,
  type SnapshotGit
} from './worktree-snapshot-git'

let sandbox: LostWorkSandbox
let repoPath: string
let git: SnapshotGit

beforeEach(async () => {
  sandbox = await createLostWorkSandbox()
  repoPath = (await createLostWorkRepo(sandbox)).path
  git = (args, options) =>
    new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        cwd: options.cwd,
        env: {
          PATH: process.env.PATH ?? '',
          HOME: sandbox.root,
          GIT_CONFIG_GLOBAL: sandbox.emptyConfig,
          GIT_CONFIG_NOSYSTEM: '1',
          ...options.env
        }
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => (stdout += String(chunk)))
      child.stderr.on('data', (chunk) => (stderr += String(chunk)))
      child.on('error', reject)
      child.on('close', (code) =>
        code === 0 ? resolve(stdout) : reject(new Error(`git ${args[0]}: ${stderr.trim()}`))
      )
      child.stdin.end(options.stdin ?? '')
    })
})

afterEach(async () => {
  await sandbox.dispose()
})

const repo = () => ({ id: 'repo-1', name: 'project', path: repoPath })

async function addWorktree(branch: string): Promise<string> {
  const path = join(sandbox.root, `wt-${branch}`)
  await sandbox.run(repoPath, 'worktree', 'add', '-q', '-b', branch, path, 'main')
  return path
}

describe('createWorktreeSnapshot', () => {
  it('makes no snapshot for a clean, fully pushed worktree', async () => {
    const path = await addWorktree('clean')
    expect(await createWorktreeSnapshot(git, path, 1_000)).toBeNull()
    expect(await listWorktreeSnapshots(git, repo(), 14)).toEqual([])
  })

  it('snapshots an uncommitted edit and an untracked file, not an ignored one', async () => {
    const path = await addWorktree('dirty')
    await commitFile(sandbox, repoPath, '.gitignore', '.env\n', 'ignore')
    await sandbox.run(path, 'merge', '-q', 'main')
    await writeFile(join(path, 'README.md'), 'edited\n')
    await writeFile(join(path, 'new.txt'), 'untracked\n')
    await writeFile(join(path, '.env'), 'SECRET=1\n')
    const indexBefore = await sandbox.run(path, 'status', '--porcelain=v1')

    const created = await createWorktreeSnapshot(git, path, 5_000)

    expect(created?.ref).toBe('refs/orca/snapshots/wt-dirty/5000')
    expect(await sandbox.run(path, 'status', '--porcelain=v1')).toBe(indexBefore)
    const files = (await sandbox.run(repoPath, 'ls-tree', '-r', '--name-only', created!.commit))
      .split('\n')
      .sort()
    expect(files).toContain('new.txt')
    expect(files).not.toContain('.env')
    expect(await sandbox.run(repoPath, 'show', `${created!.commit}:README.md`)).toBe('edited')
    const [listed] = await listWorktreeSnapshots(git, repo(), 14)
    expect(listed).toMatchObject({
      id: 'wt-dirty/5000',
      branch: 'dirty',
      path,
      createdAt: 5_000,
      expiresAt: 5_000 + 14 * 86_400_000
    })
  })

  it('snapshots a clean worktree that has an unpushed commit', async () => {
    const path = await addWorktree('ahead')
    await commitFile(sandbox, path, 'a.txt', 'a\n', 'ahead')
    const created = await createWorktreeSnapshot(git, path, 2_000)
    expect(created).not.toBeNull()
  })
})

describe('restoreWorktreeSnapshot', () => {
  it('recreates the worktree with its branch, edit and untracked file', async () => {
    const path = await addWorktree('feature')
    await commitFile(sandbox, path, 'kept.txt', 'kept\n', 'work')
    const head = await sandbox.run(path, 'rev-parse', 'HEAD')
    await writeFile(join(path, 'README.md'), 'edited\n')
    await writeFile(join(path, 'new.txt'), 'untracked\n')
    const created = await createWorktreeSnapshot(git, path, 7_000)
    await sandbox.run(repoPath, 'worktree', 'remove', '--force', path)
    await sandbox.run(repoPath, 'branch', '-D', 'feature')

    const [snapshot] = await listWorktreeSnapshots(git, repo(), 14)
    const restored = await restoreWorktreeSnapshot(git, repoPath, snapshot, path)

    expect(restored).toMatchObject({ path, branch: 'feature', note: null })
    expect(await readFile(join(path, 'new.txt'), 'utf8')).toBe('untracked\n')
    expect(await readFile(join(path, 'README.md'), 'utf8')).toBe('edited\n')
    expect(await sandbox.run(path, 'rev-parse', 'HEAD')).toBe(head)
    expect(await sandbox.run(path, 'symbolic-ref', '--short', 'HEAD')).toBe('feature')
    expect(await sandbox.run(path, 'status', '--porcelain=v1')).toBe('M README.md\n?? new.txt')
    expect(created).not.toBeNull()
  })

  it('puts the worktree on a sibling branch when the name is taken at another commit', async () => {
    const path = await addWorktree('clash')
    await writeFile(join(path, 'new.txt'), 'x\n')
    await createWorktreeSnapshot(git, path, 8_000)
    await sandbox.run(repoPath, 'worktree', 'remove', '--force', path)
    await commitFile(sandbox, repoPath, 'other.txt', 'o\n', 'moves main')
    await sandbox.run(repoPath, 'branch', '-f', 'clash', 'main')

    const [snapshot] = await listWorktreeSnapshots(git, repo(), 14)
    const restored = await restoreWorktreeSnapshot(git, repoPath, snapshot, path)

    expect(restored.branch).toBe('clash-restored-8000')
    expect(restored.note).toContain('clash')
    expect(existsSync(join(path, 'new.txt'))).toBe(true)
  })
})

describe('pruneWorktreeSnapshots', () => {
  it('deletes only snapshots past the retention', async () => {
    const path = await addWorktree('old')
    await writeFile(join(path, 'a.txt'), 'a\n')
    await createWorktreeSnapshot(git, path, 1_000)
    await rm(join(path, 'a.txt'))
    await writeFile(join(path, 'b.txt'), 'b\n')
    const day = 86_400_000
    await createWorktreeSnapshot(git, path, 10 * day)

    const pruned = await pruneWorktreeSnapshots(git, repo(), 14, 16 * day)

    expect(pruned).toBe(1)
    expect((await listWorktreeSnapshots(git, repo(), 14)).map((s) => s.id)).toEqual([
      `wt-old/${10 * day}`
    ])
  })
})

describe('snapshotWorkspaceName', () => {
  it('keeps a ref-safe folder name', () => {
    expect(snapshotWorkspaceName('/w/my feature//')).toBe('my-feature')
    expect(snapshotWorkspaceName('/')).toBe('workspace')
  })
})
