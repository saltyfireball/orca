// Worker archive's landing checks over throwaway repos: dirty files, ignored output, ancestry,
// patch-equivalent landing (cherry-pick) and a branch with no commits of its own.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  commitFile,
  createLostWorkRepo,
  createLostWorkSandbox,
  type LostWorkSandbox
} from '../lost-work/lost-work.test-fixture'
import { readWorkerArchiveLanding } from './worker-archive-git'

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

describe('readWorkerArchiveLanding', () => {
  it('reads a worktree with no commits of its own and no changes as landed', async () => {
    const path = await addWorktree('idle')
    expect(await readWorkerArchiveLanding(sandbox.git, path, undefined)).toEqual({
      dirtyFiles: 0,
      unlandedCommits: 0
    })
  })

  it('counts uncommitted and untracked files but not ignored build output', async () => {
    const path = await addWorktree('busy')
    await commitFile(sandbox, repoPath, '.gitignore', 'node_modules/\n', 'ignore')
    await sandbox.run(path, 'merge', '-q', 'main')
    await mkdir(join(path, 'node_modules'))
    await writeFile(join(path, 'node_modules', 'big.bin'), 'x'.repeat(1000))
    expect((await readWorkerArchiveLanding(sandbox.git, path, undefined)).dirtyFiles).toBe(0)
    await writeFile(join(path, 'notes.txt'), 'untracked\n')
    await writeFile(join(path, 'README.md'), 'edited\n')
    expect((await readWorkerArchiveLanding(sandbox.git, path, undefined)).dirtyFiles).toBe(2)
  })

  it('counts commits that are on no base branch', async () => {
    const path = await addWorktree('open')
    await commitFile(sandbox, path, 'a.txt', 'a\n', 'a')
    await commitFile(sandbox, path, 'b.txt', 'b\n', 'b')
    expect((await readWorkerArchiveLanding(sandbox.git, path, undefined)).unlandedCommits).toBe(2)
  })

  it('reads commits that reached the base by fast-forward as landed', async () => {
    const path = await addWorktree('ff')
    await commitFile(sandbox, path, 'a.txt', 'a\n', 'a')
    await sandbox.run(repoPath, 'merge', '-q', '--ff-only', 'ff')
    await sandbox.run(repoPath, 'push', '-q', 'origin', 'main')
    await sandbox.run(path, 'fetch', '-q', 'origin')
    expect((await readWorkerArchiveLanding(sandbox.git, path, undefined)).unlandedCommits).toBe(0)
  })

  it('reads commits cherry-picked onto the base as landed, though their shas differ', async () => {
    const path = await addWorktree('picked')
    const sha = await commitFile(sandbox, path, 'a.txt', 'a\n', 'a')
    await commitFile(sandbox, repoPath, 'other.txt', 'o\n', 'moved on')
    await sandbox.run(repoPath, 'cherry-pick', sha)
    await sandbox.run(repoPath, 'push', '-q', 'origin', 'main')
    await sandbox.run(path, 'fetch', '-q', 'origin')
    expect((await readWorkerArchiveLanding(sandbox.git, path, undefined)).unlandedCommits).toBe(0)
  })

  it('counts a commit as landed when any base has it, as with a fork next to its upstream', async () => {
    const path = await addWorktree('forked')
    await commitFile(sandbox, path, 'a.txt', 'a\n', 'a')
    const other = join(sandbox.root, 'fork.git')
    await sandbox.run(sandbox.root, 'init', '-q', '--bare', '-b', 'main', other)
    await sandbox.run(repoPath, 'remote', 'add', 'fork', other)
    await sandbox.run(path, 'push', '-q', 'fork', 'forked:main')
    await sandbox.run(repoPath, 'fetch', '-q', 'fork')
    await sandbox.run(repoPath, 'remote', 'set-head', 'fork', 'main')
    expect((await readWorkerArchiveLanding(sandbox.git, path, undefined)).unlandedCommits).toBe(0)
  })

  it('reads an unreadable folder as unknown', async () => {
    const landing = await readWorkerArchiveLanding(
      sandbox.git,
      join(sandbox.root, 'missing'),
      undefined
    )
    expect(landing.dirtyFiles).toBeNull()
    expect(landing.unlandedCommits).toBeNull()
  })
})
