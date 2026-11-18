// SLRM-2384: keep main current over throwaway repos, one per case. Each case clones a bare origin,
// then a second clone pushes a new commit so the project's main is behind.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  commitFile,
  createLostWorkRepo,
  createLostWorkSandbox,
  type LostWorkSandbox
} from '../lost-work/lost-work.test-fixture'
import { syncMainSyncRepo, type MainSyncRepoDeps } from './main-sync-repo'
import type { LostWorkRepo } from '../lost-work/lost-work-scan'

let sandbox: LostWorkSandbox

beforeEach(async () => {
  sandbox = await createLostWorkSandbox()
})

afterEach(async () => {
  await sandbox.dispose()
})

function deps(extra: Partial<MainSyncRepoDeps> = {}): MainSyncRepoDeps {
  return { git: (args, options) => sandbox.git(args, options), now: () => 1_000, ...extra }
}

/** A project, and origin one commit ahead of it; resolves the new origin commit. */
async function projectBehind(): Promise<{ repo: LostWorkRepo; upstream: string }> {
  const repo = await createLostWorkRepo(sandbox)
  const other = join(sandbox.root, 'other')
  await sandbox.run(sandbox.root, 'clone', '-q', join(sandbox.root, 'project-origin.git'), other)
  const upstream = await commitFile(sandbox, other, 'NEW.md', 'new\n', 'upstream work')
  await sandbox.run(other, 'push', '-q', 'origin', 'main')
  return { repo, upstream }
}

async function head(path: string, ref = 'refs/heads/main'): Promise<string> {
  return sandbox.run(path, 'rev-parse', ref)
}

// Why: each case builds real git repos in a temp dir, which can pass 5s on a loaded CI runner.
describe('syncMainSyncRepo', { timeout: 30_000 }, () => {
  it('fast-forwards a clean main checkout that is behind', async () => {
    const { repo, upstream } = await projectBehind()
    const result = await syncMainSyncRepo(deps(), repo)
    expect(result).toMatchObject({
      outcome: 'updated',
      reason: 'fast-forwarded',
      branch: 'main',
      remoteRef: 'origin/main',
      to: upstream.slice(0, 12)
    })
    expect(await head(repo.path)).toBe(upstream)
    expect(await sandbox.run(repo.path, 'status', '--porcelain')).toBe('')
  })

  it('still moves past an untracked file, and reports up-to-date next time', async () => {
    const { repo, upstream } = await projectBehind()
    await writeFile(join(repo.path, 'scratch.txt'), 'mine\n')
    expect((await syncMainSyncRepo(deps(), repo)).reason).toBe('fast-forwarded')
    expect(await head(repo.path)).toBe(upstream)
    expect((await syncMainSyncRepo(deps(), repo)).reason).toBe('up-to-date')
  })

  it('leaves a dirty checkout alone', async () => {
    const { repo } = await projectBehind()
    const before = await head(repo.path)
    await writeFile(join(repo.path, 'README.md'), 'edited\n')
    const result = await syncMainSyncRepo(deps(), repo)
    expect(result).toMatchObject({ outcome: 'skipped', reason: 'dirty' })
    expect(await head(repo.path)).toBe(before)
    expect(await head(repo.path, 'refs/remotes/origin/main')).not.toBe(before)
  })

  it('leaves a checkout with a merge under way alone', async () => {
    const { repo } = await projectBehind()
    const before = await head(repo.path)
    await writeFile(join(repo.path, '.git', 'MERGE_HEAD'), `${before}\n`)
    expect((await syncMainSyncRepo(deps(), repo)).reason).toBe('operation')
    expect(await head(repo.path)).toBe(before)
  })

  it('leaves a checkout in use alone', async () => {
    const { repo } = await projectBehind()
    const before = await head(repo.path)
    const result = await syncMainSyncRepo(
      deps({ isCheckoutInUse: (path) => path === repo.path }),
      repo
    )
    expect(result.reason).toBe('in-use')
    expect(await head(repo.path)).toBe(before)
  })

  it('never touches a diverged main', async () => {
    const { repo } = await projectBehind()
    const local = await commitFile(sandbox, repo.path, 'LOCAL.md', 'local\n', 'local work')
    const result = await syncMainSyncRepo(deps(), repo)
    expect(result).toMatchObject({ outcome: 'skipped', reason: 'diverged' })
    expect(await head(repo.path)).toBe(local)
  })

  it('reports a main that is only ahead', async () => {
    const repo = await createLostWorkRepo(sandbox)
    const local = await commitFile(sandbox, repo.path, 'LOCAL.md', 'local\n', 'local work')
    expect(await syncMainSyncRepo(deps(), repo)).toMatchObject({
      outcome: 'current',
      reason: 'ahead'
    })
    expect(await head(repo.path)).toBe(local)
  })

  it('leaves main alone when a linked worktree has it checked out', async () => {
    const { repo } = await projectBehind()
    const before = await head(repo.path)
    await sandbox.run(repo.path, 'checkout', '-q', '-b', 'feature')
    await sandbox.run(repo.path, 'worktree', 'add', '-q', join(sandbox.root, 'wt-main'), 'main')
    expect((await syncMainSyncRepo(deps(), repo)).reason).toBe('checked-out-elsewhere')
    expect(await head(repo.path)).toBe(before)
  })

  it('moves a main checked out nowhere with a compare-and-swap ref update', async () => {
    const { repo, upstream } = await projectBehind()
    await sandbox.run(repo.path, 'checkout', '-q', '-b', 'feature')
    const result = await syncMainSyncRepo(deps(), repo)
    expect(result).toMatchObject({ outcome: 'updated', reason: 'ref-moved' })
    expect(await head(repo.path)).toBe(upstream)
    expect(await sandbox.run(repo.path, 'symbolic-ref', 'HEAD')).toBe('refs/heads/feature')
  })

  it('reports a fetch that fails and changes nothing', async () => {
    const { repo } = await projectBehind()
    const before = await head(repo.path)
    await sandbox.run(repo.path, 'remote', 'set-url', 'origin', join(sandbox.root, 'gone.git'))
    const result = await syncMainSyncRepo(deps(), repo)
    expect(result).toMatchObject({ outcome: 'failed', reason: 'fetch-failed' })
    expect(result.detail).toBeTruthy()
    expect(await head(repo.path)).toBe(before)
  })

  it('skips a project with no remote or no folder', async () => {
    const path = join(sandbox.root, 'local-only')
    await sandbox.run(sandbox.root, 'init', '-q', '-b', 'main', path)
    await commitFile(sandbox, path, 'A.md', 'a\n', 'a')
    const repo = { id: 'local', name: 'local', path }
    expect((await syncMainSyncRepo(deps(), repo)).reason).toBe('no-remote')
    const gone = { id: 'gone', name: 'gone', path: join(sandbox.root, 'nope') }
    expect((await syncMainSyncRepo(deps(), gone)).reason).toBe('missing-folder')
  })

  it('follows the per-project default branch override', async () => {
    const { repo } = await projectBehind()
    await sandbox.run(repo.path, 'branch', 'release')
    await sandbox.run(repo.path, 'push', '-q', 'origin', 'release')
    const result = await syncMainSyncRepo(
      deps({ defaultBranchOverride: () => 'origin/release' }),
      repo
    )
    expect(result).toMatchObject({ branch: 'release', remoteRef: 'origin/release' })
    expect(result.reason).toBe('up-to-date')
  })
})
