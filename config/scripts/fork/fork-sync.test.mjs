// fork-sync.sh against throwaway repos: an upstream, the fork's bare origin and the job's clone.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(import.meta.dirname, 'fork-sync.sh')

let root
let env

function run(cwd, command, args, extraEnv = {}) {
  const result = spawnSync(command, args, { cwd, env: { ...env, ...extraEnv }, encoding: 'utf8' })
  return { ...result, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function git(cwd, ...args) {
  const result = run(cwd, 'git', args)
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout.trim()
}

function commit(cwd, file, content, message) {
  writeFileSync(join(cwd, file), content)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-q', '-m', message)
  return git(cwd, 'rev-parse', 'HEAD')
}

function outputs(file) {
  const values = {}
  const lines = readFileSync(file, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const heredoc = /^(\w+)<<(\w+)$/.exec(lines[i])
    if (heredoc) {
      const end = lines.indexOf(heredoc[2], i + 1)
      values[heredoc[1]] = lines.slice(i + 1, end).join('\n')
      i = end
    } else if (lines[i].includes('=')) {
      const at = lines[i].indexOf('=')
      values[lines[i].slice(0, at)] = lines[i].slice(at + 1)
    }
  }
  return values
}

/** Runs one subcommand in the job clone; returns its exit status and outputs. */
function sync(command, extraEnv = {}) {
  const out = join(root, `out-${command}-${Math.random().toString(36).slice(2)}`)
  writeFileSync(out, '')
  const result = run(join(root, 'job'), 'bash', [SCRIPT, command], {
    GITHUB_OUTPUT: out,
    ...extraEnv
  })
  return { status: result.status, out: outputs(out), log: result.stdout + result.stderr }
}

/** upstream: u1 - u2 (v1.0.0); fork main: v1.0.0 + f1 + f2; job: a fresh clone of the fork. */
function setUp() {
  const up = join(root, 'up')
  git(root, 'init', '-q', '-b', 'main', up)
  writeFileSync(join(up, 'package.json'), '{\n  "version": "1.0.0"\n}\n')
  git(up, 'add', 'package.json')
  commit(up, 'shared.txt', 'one\n', 'u1')
  const v1 = commit(up, 'upstream.txt', 'v1\n', 'u2')
  git(up, 'tag', 'v1.0.0')
  git(root, 'init', '-q', '--bare', '-b', 'main', join(root, 'origin.git'))
  const seed = join(root, 'seed')
  git(root, 'clone', '-q', up, seed)
  commit(seed, 'fork-a.txt', 'a\n', 'f1')
  commit(seed, 'fork-b.txt', 'b\n', 'f2')
  git(seed, 'push', '-q', join(root, 'origin.git'), 'HEAD:refs/heads/main')
  cloneJob()
  return { up, v1 }
}

function cloneJob() {
  rmSync(join(root, 'job'), { recursive: true, force: true })
  git(root, 'clone', '-q', '-b', 'main', join(root, 'origin.git'), join(root, 'job'))
  git(join(root, 'job'), 'remote', 'add', 'upstream', join(root, 'up'))
}

function forkCommitsOn(base) {
  return git(join(root, 'job'), 'log', '--format=%s', `${base}..main`).split('\n')
}

function publish(baseRecord, state = 'in-sync') {
  const file = join(root, 'status.json')
  writeFileSync(file, `{\n  "schema": 1,\n  "state": "${state}"\n}\n`)
  return sync('publish', { STATUS_FILE: file, BASE_RECORD: baseRecord })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fork-sync-test-'))
  const home = join(root, 'home')
  env = {
    PATH: process.env.PATH,
    HOME: home,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid'
  }
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('fork-sync.sh', () => {
  it('rebases only the fork commits on a clean sync, without a base record', () => {
    const { up, v1 } = setUp()
    const v2 = commit(up, 'upstream.txt', 'v2\n', 'u3')
    git(up, 'tag', 'v1.1.0')
    const detect = sync('detect')
    expect(detect.status).toBe(0)
    expect(detect.out).toMatchObject({
      latest: 'v1.1.0',
      latest_sha: v2,
      base_sha: v1,
      base_source: 'merge-base',
      base_version: '1.0.0',
      state: 'behind'
    })
    const rebase = sync('rebase', { BASE_SHA: v1, LATEST_SHA: v2 })
    expect(rebase.status).toBe(0)
    expect(rebase.out.changed).toBe('true')
    expect(forkCommitsOn(v2)).toEqual(['f2', 'f1'])
  })

  it('reports in sync from the record once a sync was published', () => {
    const { v1 } = setUp()
    expect(publish(v1).status).toBe(0)
    const detect = sync('detect')
    expect(detect.status).toBe(0)
    expect(detect.out).toMatchObject({ base_sha: v1, base_source: 'record', state: 'in-sync' })
  })

  it('replays only the fork commits when upstream re-cut the base tag to another commit', () => {
    const { up, v1 } = setUp()
    expect(publish(v1).status).toBe(0)
    // Upstream drops u2, re-cuts v1.0.0 on a replacement, and tags v1.1.0 after it.
    git(up, 'reset', '-q', '--hard', 'HEAD~1')
    const recut = commit(up, 'upstream.txt', 'v1 again\n', 'u2 recut')
    git(up, 'tag', '-f', 'v1.0.0', recut)
    const v2 = commit(up, 'upstream.txt', 'v2\n', 'u3')
    git(up, 'tag', 'v1.1.0')
    const detect = sync('detect')
    expect(detect.out).toMatchObject({ base_sha: v1, base_source: 'record', state: 'behind' })
    const rebase = sync('rebase', { BASE_SHA: detect.out.base_sha, LATEST_SHA: v2 })
    expect(rebase.status).toBe(0)
    expect(forkCommitsOn(v2)).toEqual(['f2', 'f1'])
  })

  it('stops on a conflict with main untouched and the conflicting files listed', () => {
    const { up, v1 } = setUp()
    const job = join(root, 'job')
    commit(job, 'shared.txt', 'fork\n', 'f3')
    git(job, 'push', '-q', 'origin', 'main')
    const oldMain = git(job, 'rev-parse', 'main')
    const v2 = commit(up, 'shared.txt', 'upstream\n', 'u3')
    git(up, 'tag', 'v1.1.0')
    expect(sync('detect').out).toMatchObject({ base_sha: v1, latest_sha: v2 })
    const conflictsFile = join(root, 'conflicts.txt')
    const rebase = sync('rebase', { BASE_SHA: v1, LATEST_SHA: v2, CONFLICTS_FILE: conflictsFile })
    expect(rebase.status).toBe(1)
    expect(rebase.out.conflict).toBe('true')
    expect(rebase.out.conflicts).toBe('shared.txt')
    expect(readFileSync(conflictsFile, 'utf8').trim()).toBe('shared.txt')
    expect(git(job, 'rev-parse', 'main')).toBe(oldMain)
    expect(git(job, 'status', '--porcelain')).toBe('')
    expect(git(join(root, 'origin.git'), 'rev-parse', 'main')).toBe(oldMain)
  })

  it('prefers the merge-base over a stale record when main was resynced by hand', () => {
    const { up, v1 } = setUp()
    expect(publish(v1).status).toBe(0)
    const v2 = commit(up, 'upstream.txt', 'v2\n', 'u3')
    git(up, 'tag', 'v1.1.0')
    const job = join(root, 'job')
    git(job, 'fetch', '-q', 'upstream', 'main')
    git(job, 'rebase', '-q', '--onto', v2, v1, 'main')
    const detect = sync('detect')
    expect(detect.out).toMatchObject({
      base_sha: v2,
      base_source: 'merge-base (record was stale)',
      state: 'in-sync'
    })
  })

  it('ignores a record that is not under main', () => {
    setUp()
    const stray = commit(join(root, 'up'), 'other.txt', 'x\n', 'unrelated')
    git(join(root, 'job'), 'fetch', '-q', 'upstream', stray)
    expect(publish(stray).status).toBe(0)
    const detect = sync('detect')
    expect(detect.out.base_source).toBe('merge-base')
    expect(detect.log).toMatch(/not under main/)
  })

  it('refuses to rebase backwards when the newest tag moved below the fork base', () => {
    const { up, v1 } = setUp()
    expect(publish(v1).status).toBe(0)
    git(up, 'tag', 'v1.1.0', 'HEAD~1')
    const detect = sync('detect')
    expect(detect.status).toBe(1)
    expect(detect.out.state).toBe('error')
    expect(detect.out.detect_error).toMatch(/older than the fork base/)
  })

  it('keeps the base record when a failed run publishes its status', () => {
    const { v1 } = setUp()
    expect(publish(v1).status).toBe(0)
    expect(publish('', 'conflict').status).toBe(0)
    const origin = join(root, 'origin.git')
    expect(git(origin, 'show', 'fork-sync-status:base')).toBe(v1)
    expect(git(origin, 'show', 'fork-sync-status:status.json')).toMatch(/"conflict"/)
    expect(git(origin, 'rev-list', '--count', 'fork-sync-status')).toBe('2')
    expect(git(origin, 'ls-tree', '--name-only', 'fork-sync-status').split('\n')).toEqual([
      'base',
      'status.json'
    ])
    const previous = run(join(root, 'job'), 'bash', [SCRIPT, 'previous'])
    expect(previous.stdout).toMatch(/"conflict"/)
  })

  it('calls a rebase that fails without unmerged files an error, not a conflict', () => {
    const { v1 } = setUp()
    const rebase = sync('rebase', { BASE_SHA: v1, LATEST_SHA: 'f'.repeat(40) })
    expect(rebase.status).toBe(1)
    expect(rebase.out.rebase_error).toBe('true')
    expect(rebase.out.conflict).toBeUndefined()
  })

  it('prints nothing for the previous status before the first publish', () => {
    setUp()
    const previous = run(join(root, 'job'), 'bash', [SCRIPT, 'previous'])
    expect(previous.status).toBe(0)
    expect(previous.stdout).toBe('')
  })
})
