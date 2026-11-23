import { describe, expect, it } from 'vitest'
import {
  checkForkCloneUrl,
  checkForkSetupParent,
  describeForkServerSetupReadiness,
  forkCloneUrlFromRepos,
  forkDirenvDefinesUse,
  forkEnvrcReadiness,
  forkProjectCloneUrl,
  forkServerSetupOffered,
  forkServerSetupParent,
  forkServerSetupReadinessOn,
  parseForkEnvrcUses,
  readForkServerSetupSettingsFrom
} from './server-setup'
import { describeForkServerSetupRun, ForkServerSetupRunResultSchema } from './server-setup-wire'

describe('phone helpers (SLRM-2406)', () => {
  it('reads only well-typed settings from an RPC answer', () => {
    expect(readForkServerSetupSettingsFrom(null)).toEqual({})
    expect(
      readForkServerSetupSettingsFrom({
        forkServerSetupOffer: false,
        forkServerSetupParent: '/srv',
        forkServerSetupReadiness: 'no'
      })
    ).toEqual({ forkServerSetupOffer: false, forkServerSetupParent: '/srv' })
  })

  it('takes the first remote among repos, credentials removed', () => {
    const remote = (remoteUrl: string) => ({
      gitRemoteIdentity: { canonicalKey: 'k', remoteName: 'origin', remoteUrl }
    })
    expect(forkCloneUrlFromRepos([{}, remote('https://user:pw@github.com/o/r.git')])).toBe(
      'https://github.com/o/r.git'
    )
    expect(forkCloneUrlFromRepos([{ gitRemoteIdentity: null }])).toBe('')
  })

  it('describes a finished run and parses it on the wire', () => {
    const run = {
      hostKey: 'runtime:e',
      serverName: 'alpha',
      cloned: true,
      clonePath: '/home/k/development/r',
      readiness: { missing: [], notes: [] }
    }
    expect(ForkServerSetupRunResultSchema.parse(run)).toEqual(run)
    expect(describeForkServerSetupRun(run)).toBe(
      'Set up on alpha: cloned into /home/k/development/r. Nothing the project needs is missing.'
    )
    expect(describeForkServerSetupRun({ ...run, cloned: false, readiness: null })).toBe(
      'alpha already had the project.'
    )
  })
})

describe('checkForkCloneUrl', () => {
  it.each([
    'https://github.com/owner/repo.git',
    'http://git.example.com/team/repo',
    'ssh://git@github.com/owner/repo.git',
    'git://example.com/repo.git',
    'git+ssh://git@example.com/owner/repo.git',
    'git@github.com:owner/repo.git',
    'example.com:repos/repo.git',
    '  https://github.com/owner/repo.git  '
  ])('accepts the network remote %s', (url) => {
    const result = checkForkCloneUrl(url)
    expect(result).toEqual({ ok: true, url: url.trim() })
  })

  it.each([
    ['', 'no git remote'],
    ['/srv/git/repo', 'local path'],
    ['./repo', 'local path'],
    ['../repo', 'local path'],
    ['~/repo', 'local path'],
    ['C:\\repos\\repo', 'local path'],
    ['C:repo', 'local path'],
    ['file:///srv/git/repo', 'not file'],
    ['FILE:///srv/git/repo', 'not file'],
    ['ext::sh -c touch% /tmp/pwned', 'spaces'],
    ['ext::sh', 'remote helper'],
    ['fd::17', 'remote helper'],
    ['--upload-pack=touch /tmp/x', 'spaces'],
    ['--upload-pack=x', 'dash'],
    ['-oProxyCommand=x', 'dash'],
    ['git@-oProxyCommand=x:repo', 'local path'],
    ['host:-repo', 'dash'],
    ['https://user:secret@github.com/owner/repo.git', 'password'],
    ['https://github.com/', 'host and a repository path'],
    ['https://github.com/owner/repo\n.git', 'control'],
    ['https://github.com/owner/re po', 'spaces']
  ])('refuses %j', (url, reason) => {
    const result = checkForkCloneUrl(url)
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.reason.toLowerCase()).toContain(reason)
  })

  it('refuses a URL longer than the limit', () => {
    expect(checkForkCloneUrl(`https://github.com/${'a'.repeat(3000)}`).ok).toBe(false)
  })
})

describe('checkForkSetupParent', () => {
  it('keeps ~, ~/x and absolute folders', () => {
    expect(checkForkSetupParent('~')).toBe('~')
    expect(checkForkSetupParent(' ~/development ')).toBe('~/development')
    expect(checkForkSetupParent('/srv/code')).toBe('/srv/code')
  })

  it("refuses another user's home, control characters and empty text", () => {
    expect(checkForkSetupParent('~root/x')).toBeNull()
    expect(checkForkSetupParent('/srv/\u0000x')).toBeNull()
    expect(checkForkSetupParent('  ')).toBeNull()
  })
})

describe('settings', () => {
  it('defaults to offered, readiness on and ~/development', () => {
    expect(forkServerSetupOffered(undefined)).toBe(true)
    expect(forkServerSetupReadinessOn(null)).toBe(true)
    expect(forkServerSetupParent({})).toBe('~/development')
    expect(forkServerSetupParent({ forkServerSetupParent: '  ' })).toBe('~/development')
  })

  it('follows the settings when set', () => {
    expect(forkServerSetupOffered({ forkServerSetupOffer: false })).toBe(false)
    expect(forkServerSetupReadinessOn({ forkServerSetupReadiness: false })).toBe(false)
    expect(forkServerSetupParent({ forkServerSetupParent: '/srv/code' })).toBe('/srv/code')
  })
})

describe('forkProjectCloneUrl', () => {
  it('takes the first source checkout with a remote, without credentials', () => {
    const repos = [
      { id: 'a' },
      { id: 'b', gitRemoteIdentity: { remoteUrl: 'https://tok:x@github.com/o/r.git' } }
    ] as never[]
    expect(forkProjectCloneUrl({ sourceRepoIds: ['a', 'b'] }, repos)).toBe(
      'https://github.com/o/r.git'
    )
  })

  it("falls back to the project's own remote, then nothing", () => {
    const project = {
      sourceRepoIds: ['x'],
      gitRemoteIdentity: { remoteUrl: 'git@github.com:o/r.git' }
    } as never
    expect(forkProjectCloneUrl(project, [])).toBe('git@github.com:o/r.git')
    expect(forkProjectCloneUrl(undefined, [])).toBe('')
  })
})

describe('direnv readiness', () => {
  it('reads use lines and skips comments', () => {
    expect(
      parseForkEnvrcUses('# use nope\nuse secrets my-app # comment\n  use node 20\nexport X=1')
    ).toEqual([
      { name: 'secrets', args: 'my-app' },
      { name: 'node', args: '20' }
    ])
  })

  // A backtracking regex took minutes on the first line; the test timeout is the bound here.
  it('reads a hostile line in linear time', () => {
    const hostile = `use a${' '.repeat(40_000)}x\u2028y\n${'use b '.repeat(200)}\nuse c${'\t'.repeat(900)}z`
    expect(parseForkEnvrcUses(hostile)).toEqual([{ name: 'c', args: 'z' }])
  })

  it('finds use_ functions in either shell form', () => {
    expect(forkDirenvDefinesUse('use_secrets() {\n}', 'secrets')).toBe(true)
    expect(forkDirenvDefinesUse('function use_secrets {\n}', 'secrets')).toBe(true)
    expect(forkDirenvDefinesUse('# use_secrets is not here', 'secrets')).toBe(false)
    expect(forkDirenvDefinesUse('use_secretsx() {}', 'secrets')).toBe(false)
  })

  it('lists direnv and undefined use functions as missing', () => {
    const result = forkEnvrcReadiness({
      envrc: 'use secrets app\nuse node\nuse mise',
      direnvFound: false,
      direnvRc: 'use_mise() { :; }'
    })
    expect(result.missing).toEqual([
      'direnv (the project has an .envrc)',
      'direnv function use_secrets (for "use secrets app" in .envrc)'
    ])
    expect(result.notes).toEqual(['.envrc runs "use node"', '.envrc runs "use mise"'])
  })

  it('has nothing to say without an .envrc', () => {
    expect(forkEnvrcReadiness({ envrc: null, direnvFound: false, direnvRc: '' })).toEqual({
      missing: [],
      notes: []
    })
  })

  it('describes the result in one line', () => {
    expect(describeForkServerSetupReadiness({ missing: [], notes: [] })).toBe(
      'Nothing the project needs is missing.'
    )
    expect(describeForkServerSetupReadiness({ missing: ['pnpm', 'direnv'], notes: [] })).toBe(
      'Missing: pnpm; direnv'
    )
  })
})
