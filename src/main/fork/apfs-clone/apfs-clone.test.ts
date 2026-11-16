import { execFile } from 'node:child_process'
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
  chmod
} from 'node:fs/promises'
import { existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ForkApfsCloneSettings } from '../../../shared/fork/apfs-clone'
import { installForkApfsCloneSettingsReader } from './apfs-clone-settings-reader'
import {
  FORK_APFS_CACHE_DIR,
  planForkApfsCheckout,
  withForkApfsCheckout
} from './apfs-clone-checkout'
import { forkCloneIgnoredFolders } from './apfs-clone-folders'
import type { ForkApfsCloneIo } from './apfs-clone-io'

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null'
}

function run(args: string[], cwd: string, env: NodeJS.ProcessEnv = GIT_ENV): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env }, (error, stdout) =>
      error ? reject(error) : resolve(stdout)
    )
  })
}

type TestIo = ForkApfsCloneIo & { clones: number; failClone: boolean }

function testIo(): TestIo {
  const io: TestIo = {
    platform: 'darwin',
    clones: 0,
    failClone: false,
    git: (args, cwd, extra) => run(args, cwd, { ...GIT_ENV, ...extra?.env }),
    cloneDir: async (source, target) => {
      io.clones += 1
      if (io.failClone) {
        await mkdir(target)
        await writeFile(join(target, 'partial.txt'), 'x')
        throw new Error('clone failed')
      }
      if (existsSync(target)) {
        throw new Error('clone target exists')
      }
      // Stands in for clonefile(2) so the test runs on any platform.
      await cp(source, target, { recursive: true, verbatimSymlinks: true })
    }
  }
  return io
}

let root: string
let repo: string
let settings: ForkApfsCloneSettings

async function commitAll(message: string): Promise<string> {
  await run(['add', '-A'], repo)
  await run(['commit', '-q', '-m', message], repo)
  return (await run(['rev-parse', 'HEAD'], repo)).trim()
}

async function addWorktree(
  name: string,
  base: string
): Promise<{
  path: string
  noCheckout: boolean
}> {
  const path = join(root, name)
  let usedNoCheckout = false
  await withForkApfsCheckout(repo, path, false, {}, async (noCheckout) => {
    usedNoCheckout = noCheckout
    await run(
      ['worktree', 'add', '-q', ...(noCheckout ? ['--no-checkout'] : []), '-b', name, path, base],
      repo
    )
  })
  return { path, noCheckout: usedNoCheckout }
}

async function status(path: string): Promise<string> {
  return (await run(['status', '--porcelain', '--untracked-files=all'], path)).trim()
}

beforeEach(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), 'fork-apfs-clone-')))
  repo = join(root, 'repo')
  await mkdir(repo)
  await run(['init', '-q', '-b', 'main'], repo)
  await writeFile(join(repo, '.gitignore'), 'node_modules/\nbuild\n')
  await writeFile(join(repo, 'a.txt'), 'one\n')
  await mkdir(join(repo, 'dir'))
  await writeFile(join(repo, 'dir', 'b.txt'), 'bee\n')
  await writeFile(join(repo, 'run.sh'), '#!/bin/sh\n')
  await chmod(join(repo, 'run.sh'), 0o755)
  await symlink('a.txt', join(repo, 'link'))
  settings = {}
  installForkApfsCloneSettingsReader(() => settings)
})

afterEach(async () => {
  installForkApfsCloneSettingsReader(null)
  await rm(root, { recursive: true, force: true })
})

describe('APFS clone checkout', () => {
  beforeEach(() => {
    settings = { forkApfsCloneCheckout: true }
  })

  it('fills new worktrees from the cache and keeps the cache on the latest commit', async () => {
    const first = await commitAll('one')
    const io = testIo()
    // The hook builds its own io; drive the plan directly to inject the test io.
    const plan = await planForkApfsCheckout(repo, {}, io)
    expect(plan).not.toBeNull()
    const wt1 = join(root, 'wt1')
    await run(['worktree', 'add', '-q', '--no-checkout', '-b', 'wt1', wt1, first], repo)
    expect(await plan!.populate(wt1)).toBe('cloned')
    expect(await readFile(join(wt1, 'a.txt'), 'utf8')).toBe('one\n')
    expect(await readlink(join(wt1, 'link'))).toBe('a.txt')
    expect(await status(wt1)).toBe('')
    const cacheHead = join(repo, '.git', FORK_APFS_CACHE_DIR, 'head')
    expect((await readFile(cacheHead, 'utf8')).trim()).toBe(first)

    await writeFile(join(repo, 'a.txt'), 'two\n')
    await rm(join(repo, 'dir'), { recursive: true })
    await writeFile(join(repo, 'new.txt'), 'new\n')
    const second = await commitAll('two')
    const wt2 = join(root, 'wt2')
    await run(['worktree', 'add', '-q', '--no-checkout', '-b', 'wt2', wt2, second], repo)
    expect(await plan!.populate(wt2)).toBe('cloned')
    expect(await readFile(join(wt2, 'a.txt'), 'utf8')).toBe('two\n')
    expect(existsSync(join(wt2, 'dir'))).toBe(false)
    expect(await readFile(join(wt2, 'new.txt'), 'utf8')).toBe('new\n')
    expect(await status(wt2)).toBe('')
    expect((await readFile(cacheHead, 'utf8')).trim()).toBe(second)
    expect(existsSync(join(repo, '.git', FORK_APFS_CACHE_DIR, 'lock'))).toBe(false)
    // The project's own checkout and index are untouched.
    expect(await status(repo)).toBe('')
    expect(io.clones).toBe(2)
  })

  it('adds with --no-checkout only when the setting is on, and it is off by default', async () => {
    const base = await commitAll('one')
    settings = {}
    const off = await addWorktree('off', base)
    expect(off.noCheckout).toBe(false)
    expect(existsSync(join(repo, '.git', FORK_APFS_CACHE_DIR))).toBe(false)
    expect(await status(off.path)).toBe('')
  })

  it('rebuilds a cache whose files were changed, and clears crashed staging folders', async () => {
    const base = await commitAll('one')
    const io = testIo()
    const plan = await planForkApfsCheckout(repo, {}, io)
    const wt1 = join(root, 'wt1')
    await run(['worktree', 'add', '-q', '--no-checkout', '-b', 'wt1', wt1, base], repo)
    expect(await plan!.populate(wt1)).toBe('cloned')
    const cacheDir = join(repo, '.git', FORK_APFS_CACHE_DIR)
    await writeFile(join(cacheDir, 'tree', 'a.txt'), 'tampered\n')
    await mkdir(join(cacheDir, 'stage-crashed'))
    const wt2 = join(root, 'wt2')
    await run(['worktree', 'add', '-q', '--no-checkout', '-b', 'wt2', wt2, base], repo)
    expect(await plan!.populate(wt2)).toBe('cloned')
    expect(await readFile(join(wt2, 'a.txt'), 'utf8')).toBe('one\n')
    expect(await status(wt2)).toBe('')
    expect(existsSync(join(cacheDir, 'stage-crashed'))).toBe(false)
  })

  it('stays off without an installed reader, on other platforms and for WSL', async () => {
    await commitAll('one')
    expect(await planForkApfsCheckout(repo, {}, { ...testIo(), platform: 'linux' })).toBeNull()
    expect(await planForkApfsCheckout(repo, { wslDistro: 'Ubuntu' }, testIo())).toBeNull()
    installForkApfsCloneSettingsReader(null)
    expect(await planForkApfsCheckout(repo, {}, testIo())).toBeNull()
  })

  it('skips repositories with a post-checkout hook or a sparse checkout', async () => {
    await commitAll('one')
    const hook = join(repo, '.git', 'hooks', 'post-checkout')
    await mkdir(join(repo, '.git', 'hooks'), { recursive: true })
    await writeFile(hook, '#!/bin/sh\n')
    expect(await planForkApfsCheckout(repo, {}, testIo())).toBeNull()
    await rm(hook)
    await run(['config', 'core.sparseCheckout', 'true'], repo)
    expect(await planForkApfsCheckout(repo, {}, testIo())).toBeNull()
  })

  it('checks out plainly when .gitattributes uses a filter', async () => {
    await writeFile(join(repo, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs\n')
    const base = await commitAll('one')
    const io = testIo()
    const plan = await planForkApfsCheckout(repo, {}, io)
    const wt = join(root, 'wt')
    await run(['worktree', 'add', '-q', '--no-checkout', '-b', 'wt', wt, base], repo)
    expect(await plan!.populate(wt)).toBe('plain')
    expect(io.clones).toBe(0)
    expect(await status(wt)).toBe('')
  })

  it('falls back to a clean plain checkout when the clone fails', async () => {
    const base = await commitAll('one')
    const io = testIo()
    io.failClone = true
    const plan = await planForkApfsCheckout(repo, {}, io)
    const wt = join(root, 'wt')
    await run(['worktree', 'add', '-q', '--no-checkout', '-b', 'wt', wt, base], repo)
    expect(await plan!.populate(wt)).toBe('plain')
    expect(existsSync(join(wt, 'partial.txt'))).toBe(false)
    expect(await readFile(join(wt, 'dir', 'b.txt'), 'utf8')).toBe('bee\n')
    expect(await status(wt)).toBe('')
  })

  it('checks out plainly when Git config defines a filter', async () => {
    const base = await commitAll('one')
    await run(['config', 'filter.lfs.clean', 'cat'], repo)
    const io = testIo()
    const plan = await planForkApfsCheckout(repo, {}, io)
    const wt = join(root, 'wt')
    await run(['worktree', 'add', '-q', '--no-checkout', '-b', 'wt', wt, base], repo)
    expect(await plan!.populate(wt)).toBe('plain')
    expect(io.clones).toBe(0)
  })

  it('checks out plainly while another create holds the cache', async () => {
    const base = await commitAll('one')
    await mkdir(join(repo, '.git', FORK_APFS_CACHE_DIR), { recursive: true })
    await writeFile(join(repo, '.git', FORK_APFS_CACHE_DIR, 'lock'), '1')
    const io = testIo()
    const plan = await planForkApfsCheckout(repo, {}, io)
    const wt = join(root, 'wt')
    await run(['worktree', 'add', '-q', '--no-checkout', '-b', 'wt', wt, base], repo)
    expect(await plan!.populate(wt)).toBe('plain')
    expect(io.clones).toBe(0)
    expect(await status(wt)).toBe('')
  })
})

describe('APFS clone of ignored folders', () => {
  async function setupWorktree(): Promise<string> {
    const base = await commitAll('one')
    const wt = join(root, 'wt')
    await run(['worktree', 'add', '-q', '-b', 'wt', wt, base], repo)
    return wt
  }

  it('clones ignored folders that the worktree lacks, and only those', async () => {
    const wt = await setupWorktree()
    await mkdir(join(repo, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(repo, 'node_modules', 'pkg', 'index.js'), 'x')
    await symlink('pkg', join(repo, 'node_modules', 'alias'))
    await mkdir(join(repo, 'build'))
    await mkdir(join(wt, 'build'))
    await mkdir(join(repo, 'dir', 'tracked-ish'))
    await mkdir(join(repo, 'outside'))
    settings = {
      forkApfsCloneFolders: ['node_modules', 'build', 'dir/tracked-ish', 'missing', '../outside']
    }
    const outcome = await forkCloneIgnoredFolders(repo, wt, {}, testIo())
    expect(outcome).toEqual({
      node_modules: 'cloned',
      build: 'target exists',
      'dir/tracked-ish': 'not ignored',
      missing: 'no source'
    })
    expect(await readFile(join(wt, 'node_modules', 'pkg', 'index.js'), 'utf8')).toBe('x')
    expect(await readlink(join(wt, 'node_modules', 'alias'))).toBe('pkg')
    expect(await status(wt)).toBe('')
  })

  it('refuses a source whose parent links outside the project', async () => {
    const wt = await setupWorktree()
    const elsewhere = join(root, 'elsewhere')
    await mkdir(join(elsewhere, 'node_modules'), { recursive: true })
    await symlink(elsewhere, join(repo, 'vendor'))
    await writeFile(join(repo, '.gitignore'), 'node_modules/\nbuild\nvendor\n')
    await writeFile(join(wt, '.gitignore'), 'node_modules/\nbuild\nvendor\n')
    settings = { forkApfsCloneFolders: ['vendor/node_modules'] }
    const outcome = await forkCloneIgnoredFolders(repo, wt, {}, testIo())
    expect(outcome).toEqual({ 'vendor/node_modules': 'source outside the project' })
  })

  it('skips a folder whose relative links leave it when the worktree depth differs', async () => {
    const wt = join(root, 'deeper', 'wt')
    await run(['worktree', 'add', '-q', '-b', 'wt', wt, await commitAll('one')], repo)
    await mkdir(join(root, 'store', 'pkg'), { recursive: true })
    await mkdir(join(repo, 'node_modules'))
    await symlink('../../store/pkg', join(repo, 'node_modules', 'pkg'))
    settings = { forkApfsCloneFolders: ['node_modules'] }
    expect(await forkCloneIgnoredFolders(repo, wt, {}, testIo())).toEqual({
      node_modules: 'relative links leave the folder'
    })
    expect(existsSync(join(wt, 'node_modules'))).toBe(false)
  })

  it('removes a partial copy when the clone fails', async () => {
    const wt = await setupWorktree()
    await mkdir(join(repo, 'node_modules'))
    const io = testIo()
    io.cloneDir = async (_source, target) => {
      await mkdir(target)
      throw new Error('clone failed')
    }
    const outcome = await forkCloneIgnoredFolders(repo, wt, {}, io)
    expect(outcome).toEqual({ node_modules: 'failed' })
    expect(existsSync(join(wt, 'node_modules'))).toBe(false)
  })

  it('does nothing when empty, off platform, or without a reader', async () => {
    const wt = await setupWorktree()
    await mkdir(join(repo, 'node_modules'))
    settings = { forkApfsCloneFolders: [] }
    expect(await forkCloneIgnoredFolders(repo, wt, {}, testIo())).toEqual({})
    settings = {}
    expect(await forkCloneIgnoredFolders(repo, wt, {}, { ...testIo(), platform: 'win32' })).toEqual(
      {}
    )
    installForkApfsCloneSettingsReader(null)
    expect(await forkCloneIgnoredFolders(repo, wt, {}, testIo())).toEqual({})
    expect(existsSync(join(wt, 'node_modules'))).toBe(false)
  })
})
