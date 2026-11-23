// fork-sync.sh against throwaway repos: an upstream, the fork's bare origin and the job's clone.
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(import.meta.dirname, 'fork-sync.sh')

let root
let env

function run(cwd, command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...env, ...extraEnv },
    encoding: 'utf8'
  })
  return {
    ...result,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  }
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
  return {
    status: result.status,
    out: outputs(out),
    log: result.stdout + result.stderr
  }
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

/**
 * As upstream releases: each stable tag is a release commit (a version bump) beside the branch,
 * never on it. upstream main: u1 - u2 - u3; v1.0.0 = r1 on u2, v1.1.0 = r2 on u3; fork main:
 * r1 + f1 + f2.
 */
function setUpOffBranchReleases() {
  const up = join(root, 'up')
  const release = (version, from) => {
    git(up, 'checkout', '-q', '--detach', from)
    const sha = commit(
      up,
      'package.json',
      `{\n  "name": "up",\n  "version": "${version}",\n  "description": "upstream"\n}\n`,
      `release: v${version}`
    )
    git(up, 'tag', `v${version}`)
    git(up, 'checkout', '-q', 'main')
    return sha
  }
  git(root, 'init', '-q', '-b', 'main', up)
  commit(
    up,
    'package.json',
    '{\n  "name": "up",\n  "version": "0.9.0",\n  "description": "upstream"\n}\n',
    'u1'
  )
  const u2 = commit(up, 'upstream.txt', 'v1\n', 'u2')
  const r1 = release('1.0.0', u2)
  const r2 = release('1.1.0', commit(up, 'upstream.txt', 'v2\n', 'u3'))
  git(root, 'init', '-q', '--bare', '-b', 'main', join(root, 'origin.git'))
  const seed = join(root, 'seed')
  git(root, 'clone', '-q', up, seed)
  git(seed, 'checkout', '-q', '--detach', r1)
  commit(seed, 'fork-a.txt', 'a\n', 'f1')
  commit(seed, 'fork-b.txt', 'b\n', 'f2')
  git(seed, 'push', '-q', join(root, 'origin.git'), 'HEAD:refs/heads/main')
  cloneJob()
  return { u2, r1, r2 }
}

function cloneJob() {
  rmSync(join(root, 'job'), { recursive: true, force: true })
  git(root, 'clone', '-q', '-b', 'main', join(root, 'origin.git'), join(root, 'job'))
  git(join(root, 'job'), 'remote', 'add', 'upstream', join(root, 'up'))
}

function publish(state = 'in-sync') {
  const file = join(root, 'status.json')
  writeFileSync(file, `{\n  "schema": 1,\n  "state": "${state}"\n}\n`)
  return sync('publish', { STATUS_FILE: file })
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
  it('merges a new upstream tag as one merge commit and keeps every fork commit', () => {
    const { up, v1 } = setUp()
    const v2 = commit(up, 'upstream.txt', 'v2\n', 'u3')
    git(up, 'tag', 'v1.1.0')
    const job = join(root, 'job')
    const oldMain = git(job, 'rev-parse', 'main')
    const detect = sync('detect')
    expect(detect.status).toBe(0)
    expect(detect.out).toMatchObject({
      latest: 'v1.1.0',
      latest_sha: v2,
      base_sha: v1,
      base_version: '1.0.0',
      old_main: oldMain,
      state: 'behind'
    })
    const merge = sync('merge', { LATEST: 'v1.1.0', LATEST_SHA: v2 })
    expect(merge.status).toBe(0)
    expect(merge.out.changed).toBe('true')
    expect(merge.log).not.toMatch(/FORK-SYNC-CONFLICT/)
    // One merge commit: first parent is the old main, second is the tag; the fork history is intact.
    expect(git(job, 'rev-list', '--parents', '-n', '1', 'main').split(' ').slice(1)).toEqual([
      oldMain,
      v2
    ])
    expect(git(job, 'log', '--format=%s', '-n', '1', 'main')).toBe(
      'Merge upstream v1.1.0 into main'
    )
    expect(git(job, 'rev-list', '--count', `${oldMain}..main`)).toBe('2')
    git(job, 'merge-base', '--is-ancestor', oldMain, 'main')
    expect(sync('detect').out).toMatchObject({
      base_sha: v2,
      state: 'in-sync'
    })
  })

  it('merges a tag that sits off the upstream branch, with the base found by ancestry', () => {
    const { r1, r2 } = setUpOffBranchReleases()
    const detect = sync('detect')
    expect(detect.out).toMatchObject({
      latest: 'v1.1.0',
      latest_sha: r2,
      base_sha: r1,
      base_version: '1.0.0',
      state: 'behind'
    })
    const merge = sync('merge', { LATEST: 'v1.1.0', LATEST_SHA: r2 })
    expect(merge.status).toBe(0)
    expect(git(join(root, 'job'), 'log', '--format=%s', 'main')).toMatch(/release: v1\.1\.0/)
  })

  it('settles the release commit version bump in package.json and keeps the fork edits', () => {
    const { r2 } = setUpOffBranchReleases()
    const job = join(root, 'job')
    commit(
      job,
      'package.json',
      '{\n  "name": "up",\n  "version": "1.0.0",\n  "description": "fork"\n}\n',
      'f3'
    )
    git(job, 'push', '-q', 'origin', 'main')
    expect(sync('detect').status).toBe(0)
    const merge = sync('merge', { LATEST: 'v1.1.0', LATEST_SHA: r2 })
    expect(merge.status).toBe(0)
    expect(merge.log).toMatch(/version 1\.0\.0 -> 1\.1\.0/)
    expect(readFileSync(join(job, 'package.json'), 'utf8')).toBe(
      '{\n  "name": "up",\n  "version": "1.1.0",\n  "description": "fork"\n}\n'
    )
    expect(git(job, 'log', '--format=%s', '-n', '1')).toBe('Merge upstream v1.1.0 into main')
    expect(git(job, 'rev-list', '--parents', '-n', '1', 'main').split(' ')).toHaveLength(3)
    expect(git(job, 'status', '--porcelain')).toBe('')
  })

  it('still reports a package.json conflict when more than the version line differs', () => {
    const up = join(root, 'up')
    const { r1 } = setUpOffBranchReleases()
    const job = join(root, 'job')
    commit(
      job,
      'package.json',
      '{\n  "name": "up",\n  "version": "1.0.0",\n  "description": "fork"\n}\n',
      'f3'
    )
    git(job, 'push', '-q', 'origin', 'main')
    const oldMain = git(job, 'rev-parse', 'main')
    git(up, 'checkout', '-q', '--detach', 'v1.1.0')
    commit(
      up,
      'package.json',
      '{\n  "name": "up",\n  "version": "1.2.0",\n  "description": "theirs"\n}\n',
      'r3'
    )
    git(up, 'tag', 'v1.2.0')
    git(up, 'checkout', '-q', 'main')
    expect(r1).toBeTruthy()
    const latest = git(up, 'rev-parse', 'v1.2.0')
    expect(sync('detect').status).toBe(0)
    const merge = sync('merge', { LATEST: 'v1.2.0', LATEST_SHA: latest })
    expect(merge.status).toBe(1)
    expect(merge.log.split('\n')[0]).toBe('FORK-SYNC-CONFLICT v1.2.0')
    expect(merge.out.conflicts).toBe('package.json')
    expect(git(job, 'rev-parse', 'main')).toBe(oldMain)
    expect(git(job, 'status', '--porcelain')).toBe('')
  })

  it('stops on a conflict with the marker first, main untouched and the files listed', () => {
    const { up, v1 } = setUp()
    const job = join(root, 'job')
    commit(job, 'shared.txt', 'fork\n', 'f3')
    git(job, 'push', '-q', 'origin', 'main')
    const oldMain = git(job, 'rev-parse', 'main')
    const v2 = commit(up, 'shared.txt', 'upstream\n', 'u3')
    git(up, 'tag', 'v1.1.0')
    expect(sync('detect').out).toMatchObject({ base_sha: v1, latest_sha: v2 })
    const conflictsFile = join(root, 'conflicts.txt')
    const merge = sync('merge', {
      LATEST: 'v1.1.0',
      LATEST_SHA: v2,
      CONFLICTS_FILE: conflictsFile
    })
    expect(merge.status).toBe(1)
    expect(merge.log.split('\n')[0]).toBe('FORK-SYNC-CONFLICT v1.1.0')
    expect(merge.out.conflict).toBe('true')
    expect(merge.out.conflicts).toBe('shared.txt')
    expect(merge.out.changed).toBeUndefined()
    expect(readFileSync(conflictsFile, 'utf8').trim()).toBe('shared.txt')
    expect(git(job, 'rev-parse', 'main')).toBe(oldMain)
    expect(git(job, 'status', '--porcelain')).toBe('')
    expect(git(join(root, 'origin.git'), 'rev-parse', 'main')).toBe(oldMain)
  })

  it('exits 0 on a conflict when told to go on, with the marker and outputs the same', () => {
    const { up } = setUp()
    const job = join(root, 'job')
    commit(job, 'shared.txt', 'fork\n', 'f3')
    git(job, 'push', '-q', 'origin', 'main')
    const oldMain = git(job, 'rev-parse', 'main')
    const v2 = commit(up, 'shared.txt', 'upstream\n', 'u3')
    git(up, 'tag', 'v1.1.0')
    expect(sync('detect').status).toBe(0)
    const merge = sync('merge', { LATEST: 'v1.1.0', LATEST_SHA: v2, CONFLICT_CONTINUES: 'true' })
    expect(merge.status).toBe(0)
    expect(merge.log.split('\n')[0]).toBe('FORK-SYNC-CONFLICT v1.1.0')
    expect(merge.out.conflict).toBe('true')
    expect(merge.out.conflicts).toBe('shared.txt')
    expect(merge.out.changed).toBeUndefined()
    expect(git(job, 'rev-parse', 'HEAD')).toBe(oldMain)
    expect(git(job, 'status', '--porcelain')).toBe('')
    // The merge-less base is still found, so the release of main keeps the current base tag.
    expect(sync('merged-tag').log.trim()).toBe('1.0.0')
  })

  it('still fails a merge error when told to go on after a conflict', () => {
    setUp()
    const merge = sync('merge', {
      LATEST: 'v9.9.9',
      LATEST_SHA: 'f'.repeat(40),
      CONFLICT_CONTINUES: 'true'
    })
    expect(merge.status).toBe(1)
    expect(merge.out.merge_error).toBe('true')
  })

  describe('released and release-line', () => {
    // A fake gh on PATH that lists the published release tags, one per line.
    function withReleases(tags) {
      const bin = join(root, 'bin')
      mkdirSync(bin, { recursive: true })
      writeFileSync(
        join(bin, 'gh'),
        `#!/bin/sh\nprintf '%s\\n' ${tags.map((t) => `'${t}'`).join(' ')}\n`
      )
      chmodSync(join(bin, 'gh'), 0o755)
      return { PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: 'example/fork' }
    }

    it('says main has no release when no release tag points at it', () => {
      setUp()
      const job = join(root, 'job')
      // An older release exists, and main has moved on since.
      git(job, 'tag', 'v1.0.1001')
      git(job, 'push', '-q', 'origin', 'v1.0.1001')
      commit(job, 'fork-c.txt', 'c\n', 'f3')
      git(job, 'push', '-q', 'origin', 'main')
      const result = sync('released', withReleases(['v1.0.1001']))
      expect(result.status).toBe(0)
      expect(result.out.released).toBe('false')
    })

    it('says main is released when a published release tag points at it', () => {
      setUp()
      const job = join(root, 'job')
      git(job, 'tag', 'v1.0.1002')
      git(job, 'push', '-q', 'origin', 'v1.0.1002')
      expect(sync('released', withReleases(['v1.0.1002'])).out.released).toBe('true')
      // A tag with no published (non-draft) release does not count.
      expect(sync('released', withReleases(['v1.0.1009'])).out.released).toBe('false')
    })

    it('names the release of main after a conflict, or why none went out', () => {
      setUp()
      const line = (extra) => sync('release-line', extra).log.trim()
      const base = { WHY: 'conflict', VERSION: '1.0.1003', SHA: 'abc123' }
      expect(line({ ...base, RELEASED: 'false', BUILD_RESULT: 'success' })).toBe(
        'Release of main despite the upstream conflict: yes, v1.0.1003 (abc123) went out.'
      )
      expect(line({ ...base, RELEASED: 'true', BUILD_RESULT: 'skipped' })).toMatch(
        /none built, main already has a fork release/
      )
      expect(line({ ...base, RELEASED: 'false', BUILD_RESULT: 'failure' })).toMatch(
        /did not go out \(build failure\)/
      )
      expect(line({ ...base, RELEASED: '', BUILD_RESULT: 'skipped' })).toMatch(
        /none, the sync job stopped/
      )
      expect(line({ ...base, WHY: 'skipped', RELEASED: 'false', BUILD_RESULT: 'success' })).toMatch(
        /^Release of main with the upstream merge skipped: yes/
      )
    })
  })

  it('does nothing on a release-only run: main already has the newest tag', () => {
    const { v1 } = setUp()
    const detect = sync('detect')
    expect(detect.status).toBe(0)
    expect(detect.out).toMatchObject({
      latest: 'v1.0.0',
      base_sha: v1,
      state: 'in-sync'
    })
    expect(detect.out.changed).toBeUndefined()
  })

  it('names the version after a merge from the newest tag merged, not from package.json', () => {
    const { r2 } = setUpOffBranchReleases()
    const job = join(root, 'job')
    expect(sync('detect').status).toBe(0)
    expect(run(job, 'bash', [SCRIPT, 'merged-tag']).stdout.trim()).toBe('1.0.0')
    expect(sync('merge', { LATEST: 'v1.1.0', LATEST_SHA: r2 }).status).toBe(0)
    const merged = run(job, 'bash', [SCRIPT, 'merged-tag'])
    expect(merged.stdout.trim()).toBe('1.1.0')
    const next = spawnSync('node', [resolve(import.meta.dirname, 'fork-version.mjs'), '1.1.0'], {
      input: 'v1.0.5\nv1.1.1\nv1.1.2\n',
      encoding: 'utf8'
    })
    expect(next.stdout.trim()).toBe('1.1.3')
  })

  it('treats a tag upstream re-cut to another commit as new and merges it', () => {
    const { up } = setUp()
    git(up, 'reset', '-q', '--hard', 'HEAD~1')
    const recut = commit(up, 'recut.txt', 'again\n', 'u2 recut')
    git(up, 'tag', '-f', 'v1.0.0', recut)
    const detect = sync('detect')
    expect(detect.out).toMatchObject({ state: 'behind', base_version: '1.0.0' })
    expect(detect.out.base_source).toMatch(/was moved upstream/)
    expect(sync('merge', { LATEST: 'v1.0.0', LATEST_SHA: recut }).status).toBe(0)
  })

  it('fails detect when no stable upstream tag is merged into main', () => {
    setUp()
    const stray = commit(join(root, 'up'), 'other.txt', 'x\n', 'unrelated')
    git(join(root, 'up'), 'tag', 'v2.0.0', stray)
    git(join(root, 'job'), 'checkout', '-q', '--orphan', 'x')
    git(join(root, 'job'), 'commit', '-q', '--allow-empty', '-m', 'orphan')
    const detect = sync('detect')
    expect(detect.status).toBe(1)
    expect(detect.out.detect_error).toMatch(/No stable upstream tag is merged/)
  })

  it('calls a merge that fails without unmerged files an error, not a conflict', () => {
    setUp()
    const merge = sync('merge', {
      LATEST: 'v9.9.9',
      LATEST_SHA: 'f'.repeat(40)
    })
    expect(merge.status).toBe(1)
    expect(merge.out.merge_error).toBe('true')
    expect(merge.out.conflict).toBeUndefined()
    expect(merge.log).not.toMatch(/FORK-SYNC-CONFLICT/)
  })

  it('refuses to push-ready an unsigned merge commit when signing is required', () => {
    const { up } = setUp()
    const v2 = commit(up, 'upstream.txt', 'v2\n', 'u3')
    git(up, 'tag', 'v1.1.0')
    expect(sync('detect').status).toBe(0)
    const merge = sync('merge', {
      LATEST: 'v1.1.0',
      LATEST_SHA: v2,
      SIGNING: 'true'
    })
    expect(merge.status).toBe(1)
    expect(merge.out.unsigned).toBe('true')
  })

  it('publishes only status.json and reads it back', () => {
    setUp()
    expect(publish().status).toBe(0)
    expect(publish('conflict').status).toBe(0)
    const origin = join(root, 'origin.git')
    expect(git(origin, 'show', 'fork-sync-status:status.json')).toMatch(/"conflict"/)
    expect(git(origin, 'rev-list', '--count', 'fork-sync-status')).toBe('2')
    expect(git(origin, 'ls-tree', '--name-only', 'fork-sync-status')).toBe('status.json')
    const previous = run(join(root, 'job'), 'bash', [SCRIPT, 'previous'])
    expect(previous.stdout).toMatch(/"conflict"/)
  })

  it('prints nothing for the previous status before the first publish', () => {
    setUp()
    const previous = run(join(root, 'job'), 'bash', [SCRIPT, 'previous'])
    expect(previous.status).toBe(0)
    expect(previous.stdout).toBe('')
  })
})
