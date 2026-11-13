// SLRM-2096: lost work actions over throwaway repos. Each test makes its own repo in a temp folder.
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LostWorkAction, LostWorkItem } from '../../../shared/fork/lost-work'
import { runLostWorkAction } from './lost-work-actions'
import { pullRequestCompareUrl, remoteWebUrl } from './lost-work-links'
import type { LostWorkRepo } from './lost-work-scan'
import {
  commitFile,
  createLostWorkRepo,
  createLostWorkSandbox,
  lostWorkTestDeps,
  type LostWorkSandbox
} from './lost-work.test-fixture'

let sandbox: LostWorkSandbox
let repo: LostWorkRepo
let tracked: Set<string>

beforeEach(async () => {
  sandbox = await createLostWorkSandbox()
  repo = await createLostWorkRepo(sandbox)
  tracked = new Set()
})

afterEach(async () => {
  await sandbox.dispose()
})

function deps() {
  return {
    ...lostWorkTestDeps(sandbox, tracked),
    findRepo: (id: string) => (id === repo.id ? repo : null)
  }
}

function item(over: Partial<LostWorkItem>): LostWorkItem {
  return {
    id: 'x',
    kind: 'branch',
    risk: 'would-lose-work',
    reasons: [],
    repoId: repo.id,
    repoName: repo.name,
    baseRef: 'origin/main',
    unmergedCommits: null,
    unpushedCommits: null,
    dirtyFiles: null,
    lastCommitAt: null,
    ...over
  }
}

function act(action: LostWorkAction, target: LostWorkItem, extra = {}) {
  return runLostWorkAction(deps(), { action, item: target, ...extra })
}

async function branchWithCommit(branch: string): Promise<string> {
  await sandbox.run(repo.path, 'checkout', '-q', '-b', branch)
  const head = await commitFile(sandbox, repo.path, `${branch}.txt`, 'work\n', branch)
  await sandbox.run(repo.path, 'checkout', '-q', 'main')
  return head
}

describe('runLostWorkAction', { timeout: 30_000 }, () => {
  it('saves a branch as a bundle and a patch in the chosen folder', async () => {
    const head = await branchWithCommit('topic')
    const folder = join(sandbox.root, 'archive')
    await mkdir(folder)
    const target = item({ branch: 'topic', head })
    const bundle = await act('save-bundle', target, { folder })
    const patch = await act('save-patch', target, { folder })
    expect(bundle.ok && patch.ok).toBe(true)
    const files = (await readdir(folder)).sort()
    expect(files).toHaveLength(2)
    expect(files.some((file) => file.endsWith('.bundle'))).toBe(true)
    expect(files.some((file) => file.endsWith('.patch'))).toBe(true)
    await sandbox.run(
      repo.path,
      'bundle',
      'verify',
      join(
        folder,
        files.find((f) => f.endsWith('.bundle'))!
      )
    )
  })

  it('refuses to save without an existing absolute folder', async () => {
    const head = await branchWithCommit('topic')
    const target = item({ branch: 'topic', head })
    expect(await act('save-patch', target, {})).toMatchObject({ ok: false })
    expect(await act('save-patch', target, { folder: 'relative' })).toMatchObject({ ok: false })
    expect(
      await act('save-patch', target, { folder: join(sandbox.root, 'missing') })
    ).toMatchObject({ ok: false, error: 'The archive folder does not exist.' })
  })

  it('deletes a branch with commits nowhere else only after the loss is confirmed', async () => {
    const head = await branchWithCommit('topic')
    const target = item({ branch: 'topic', head })
    expect((await act('delete-branch', target)).ok).toBe(false)
    expect(await sandbox.run(repo.path, 'branch', '--list', 'topic')).toContain('topic')
    expect(await act('delete-branch', target, { confirmedLoss: true })).toEqual({ ok: true })
    expect(await sandbox.run(repo.path, 'branch', '--list', 'topic')).toBe('')
  })

  it('deletes a pushed branch without the second confirm', async () => {
    const head = await branchWithCommit('shared')
    await sandbox.run(repo.path, 'push', '-q', 'origin', 'shared')
    expect(await act('delete-branch', item({ branch: 'shared', head }))).toEqual({ ok: true })
  })

  it('refuses a branch that moved since the scan', async () => {
    await branchWithCommit('topic')
    const result = await act('delete-branch', item({ branch: 'topic', head: 'a'.repeat(40) }), {
      confirmedLoss: true
    })
    expect(result).toMatchObject({ ok: false })
    expect(result.ok ? '' : result.error).toContain('moved')
  })

  it('drops a stash only with the loss confirmed', async () => {
    await writeFile(join(repo.path, 'README.md'), 'changed\n')
    await sandbox.run(repo.path, 'stash', 'push', '-q', '-m', 'keep')
    const head = await sandbox.run(repo.path, 'rev-parse', 'stash@{0}')
    const target = item({ kind: 'stash', head, branch: null })
    expect((await act('drop-stash', target)).ok).toBe(false)
    expect(await act('drop-stash', target, { confirmedLoss: true })).toEqual({ ok: true })
    expect(await sandbox.run(repo.path, 'stash', 'list')).toBe('')
  })

  it('prunes only a worktree whose folder is gone', async () => {
    const path = join(sandbox.root, 'wt-gone')
    await sandbox.run(repo.path, 'worktree', 'add', '-q', '-b', 'gone', path, 'main')
    const target = item({ kind: 'missing-folder', path, branch: 'gone' })
    expect(await act('prune-worktree', target)).toMatchObject({ ok: false })
    await rm(path, { recursive: true, force: true })
    expect(await act('prune-worktree', target)).toEqual({ ok: true })
    expect(await sandbox.run(repo.path, 'worktree', 'list')).not.toContain('wt-gone')
    expect(await sandbox.run(repo.path, 'branch', '--list', 'gone')).toContain('gone')
  })

  it('removes an untracked worktree, asking first when it has changes', async () => {
    const path = join(sandbox.root, 'wt-orphan')
    await sandbox.run(repo.path, 'worktree', 'add', '-q', '-b', 'orphan', path, 'main')
    await writeFile(join(path, 'README.md'), 'dirty\n')
    const target = item({ kind: 'untracked-worktree', path, branch: 'orphan' })
    expect((await act('remove-untracked-worktree', target)).ok).toBe(false)
    tracked.add(`${repo.id}::${path}`)
    expect((await act('remove-untracked-worktree', target, { confirmedLoss: true })).ok).toBe(false)
    tracked.clear()
    expect(await act('remove-untracked-worktree', target, { confirmedLoss: true })).toEqual({
      ok: true
    })
    expect(existsSync(path)).toBe(false)
  })

  it('refuses projects it does not know', async () => {
    expect(await act('push', item({ repoId: 'other', branch: 'x' }))).toMatchObject({ ok: false })
  })
})

describe('remote links', () => {
  it('turns ssh, scp and https remotes into web links', () => {
    expect(remoteWebUrl('git@github.com:owner/repo.git')).toBe('https://github.com/owner/repo')
    expect(remoteWebUrl('ssh://git@github.com/owner/repo')).toBe('https://github.com/owner/repo')
    expect(remoteWebUrl('https://github.com/owner/repo.git')).toBe('https://github.com/owner/repo')
    expect(remoteWebUrl('/local/path.git')).toBeNull()
    expect(remoteWebUrl('file:///x/y')).toBeNull()
  })

  it('builds a compare link for GitHub only', () => {
    expect(pullRequestCompareUrl('https://github.com/o/r', 'main', 'feat/x')).toBe(
      'https://github.com/o/r/compare/main...feat/x?expand=1'
    )
    expect(pullRequestCompareUrl('https://gitlab.example.test/o/r', 'main', 'x')).toBeNull()
  })
})
