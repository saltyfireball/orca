import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FORK_WORKTREE_RECLAIM_DEFAULT_PATHS } from '../../../shared/fork/worktree-reclaim-glob'
import {
  applyWorktreeReclaim,
  planWorktreeReclaim,
  type ReclaimGit
} from './worktree-reclaim-files'

// Hermetic: the machine's own global ignore file must not change what counts as ignored.
const emptyHome = mkdtempSync(join(tmpdir(), 'reclaim-home-'))
const env = {
  ...process.env,
  HOME: emptyHome,
  XDG_CONFIG_HOME: emptyHome,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1'
}
const git: ReclaimGit = async (args, { cwd }) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env })

let root: string
let outside: string

function write(path: string, content = 'x'.repeat(5000)): void {
  const full = join(root, path)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'reclaim-repo-'))
  outside = mkdtempSync(join(tmpdir(), 'reclaim-outside-'))
  execFileSync('git', ['init', '-q'], { cwd: root, env })
  write('.gitignore', 'node_modules\ndist\n.env\n.env.local\nsecrets.txt\n*.log\nbuild\n')
  write('src/app.ts', 'tracked')
  write('build/tracked.txt', 'tracked inside an ignored name')
  execFileSync('git', ['add', '-f', '.gitignore', 'src/app.ts', 'build/tracked.txt'], {
    cwd: root,
    env
  })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], {
    cwd: root
  })
  write('node_modules/pkg/index.js')
  write('packages/a/node_modules/dep.js')
  write('dist/out.js')
  write('.env', 'SECRET=1')
  write('secrets.txt')
  write('debug.log')
  write('notes-untracked.md', 'not ignored')
  write('build/generated.js')
  write('dist-holder/dist/.env.local', 'SECRET=2')
  write('dist-holder/dist/a.js')
  writeFileSync(
    join(root, '.gitignore'),
    'node_modules\ndist\n.env\n.env.local\nsecrets.txt\n*.log\nbuild\n'
  )
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

afterAll(() => rmSync(emptyHome, { recursive: true, force: true }))

describe('worktree reclaim', () => {
  it('removes only ignored paths a glob names and leaves env, tracked and plain files', async () => {
    const planned = await planWorktreeReclaim({
      git,
      root,
      globs: FORK_WORKTREE_RECLAIM_DEFAULT_PATHS
    })
    const byPath = new Map(planned.map((entry) => [entry.path, entry]))
    expect([...byPath.keys()].sort()).toEqual([
      'build/generated.js',
      'dist',
      'dist-holder/dist',
      'node_modules',
      'packages/a/node_modules'
    ])
    expect(byPath.get('dist-holder/dist')?.skipped).toBe('holds-env-file')

    const result = await applyWorktreeReclaim(root, planned)
    expect(
      result
        .filter((entry) => entry.removed)
        .map((entry) => entry.path)
        .sort()
    ).toEqual(['build/generated.js', 'dist', 'node_modules', 'packages/a/node_modules'])
    for (const kept of [
      '.env',
      'secrets.txt',
      'debug.log',
      'notes-untracked.md',
      'src/app.ts',
      'build/tracked.txt',
      'dist-holder/dist/.env.local',
      '.git'
    ]) {
      expect(existsSync(join(root, kept)), kept).toBe(true)
    }
    for (const gone of ['node_modules', 'dist', 'packages/a/node_modules', 'build/generated.js']) {
      expect(existsSync(join(root, gone)), gone).toBe(false)
    }
  })

  it('does not list a path that is not git-ignored, even when a glob names it', async () => {
    write('plain/coverage/y.js')
    const planned = await planWorktreeReclaim({ git, root, globs: ['coverage'] })
    expect(planned.map((entry) => entry.path)).toEqual([])
  })

  it('never follows a symlink out of the worktree', async () => {
    writeFileSync(join(outside, 'precious.txt'), 'keep')
    symlinkSync(outside, join(root, 'node_modules-link'))
    symlinkSync(outside, join(root, 'packages', 'a', 'node_modules-out'))
    // A symlinked folder named like a glob is left alone; the target stays whole.
    rmSync(join(root, 'node_modules'), { recursive: true })
    symlinkSync(outside, join(root, 'node_modules'))
    const planned = await planWorktreeReclaim({ git, root, globs: ['node_modules'] })
    const link = planned.find((entry) => entry.path === 'node_modules')
    expect(link?.skipped).toBe('symlink')
    await applyWorktreeReclaim(root, planned)
    expect(existsSync(join(outside, 'precious.txt'))).toBe(true)
    expect(existsSync(join(root, 'node_modules'))).toBe(true)
  })

  it('refuses a planned path that resolves outside the worktree', async () => {
    writeFileSync(join(outside, 'precious.txt'), 'keep')
    symlinkSync(outside, join(root, 'linked'))
    const result = await applyWorktreeReclaim(root, [
      { path: 'linked/precious.txt', bytes: 1 },
      { path: '../escape', bytes: 1 },
      { path: '.git', bytes: 1 }
    ])
    expect(result.map((entry) => entry.skipped)).toEqual([
      'outside-worktree',
      'outside-worktree',
      'outside-worktree'
    ])
    expect(existsSync(join(outside, 'precious.txt'))).toBe(true)
    expect(existsSync(join(root, '.git'))).toBe(true)
  })
})
