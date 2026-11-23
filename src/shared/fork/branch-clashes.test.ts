import { describe, expect, it } from 'vitest'
import {
  buildForkClashes,
  FORK_CLASHES_MAX_FILES_PER_PROJECT,
  forkClashRepoMatches,
  forkClashRowKey,
  forkClashRowMarks,
  normalizeForkRemoteUrl,
  readForkBranchClashConfig,
  type ForkClashBranch,
  type ForkClashHostResult
} from './branch-clashes'

function branch(name: string, files: string[], behind = 0): ForkClashBranch {
  return {
    worktreeId: `repo::/w/${name}`,
    path: `/w/${name}`,
    branch: name,
    head: 'a'.repeat(40),
    ahead: 1,
    behind,
    files,
    filesTruncated: false
  }
}

function host(
  hostId: string,
  branches: ForkClashBranch[],
  projectKey: string | null = 'github.com/o/r'
): ForkClashHostResult {
  return {
    hostId,
    hostName: hostId === 'local' ? 'this machine' : 'alpha',
    status: 'ok',
    repos: [{ repoId: `${hostId}-repo`, name: 'r', projectKey, baseRef: 'origin/main', branches }]
  }
}

describe('normalizeForkRemoteUrl', () => {
  it('matches scp, https and ssh forms of one remote', () => {
    const forms = [
      'git@github.com:Owner/Repo.git',
      'https://github.com/owner/repo',
      'https://user@github.com/owner/repo.git/',
      'ssh://git@github.com:22/owner/repo.git'
    ]
    expect(new Set(forms.map(normalizeForkRemoteUrl))).toEqual(new Set(['github.com/owner/repo']))
  })

  it('returns null for text that is no remote', () => {
    expect(normalizeForkRemoteUrl('')).toBeNull()
    expect(normalizeForkRemoteUrl('not a url')).toBeNull()
  })
})

describe('readForkBranchClashConfig', () => {
  it('defaults to on, every 5 minutes, uncommitted on, 20 behind, servers on', () => {
    expect(readForkBranchClashConfig(undefined)).toEqual({
      enabled: true,
      intervalMinutes: 5,
      uncommitted: true,
      behindThreshold: 20,
      pairedServers: true
    })
  })

  it('clamps numbers and honours switches', () => {
    const config = readForkBranchClashConfig({
      forkBranchClashes: false,
      forkBranchClashesIntervalMinutes: 0,
      forkBranchClashesBehindThreshold: -4,
      forkBranchClashesUncommitted: false,
      forkBranchClashesPairedServers: false
    })
    expect(config).toEqual({
      enabled: false,
      intervalMinutes: 1,
      uncommitted: false,
      behindThreshold: 1,
      pairedServers: false
    })
    expect(
      readForkBranchClashConfig({ forkBranchClashesIntervalMinutes: 9999 }).intervalMinutes
    ).toBe(240)
  })
})

describe('buildForkClashes', () => {
  it('lists a file two branches change, across hosts of one project', () => {
    const result = buildForkClashes(
      [
        host('local', [branch('a', ['src/x.ts', 'only-a.ts'])]),
        host('runtime:alpha', [branch('b', ['src/x.ts'])])
      ],
      20,
      5
    )
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].files).toEqual([
      {
        file: 'src/x.ts',
        participantsTruncated: false,
        participants: [
          expect.objectContaining({ hostId: 'local', branch: 'a' }),
          expect.objectContaining({ hostId: 'runtime:alpha', branch: 'b' })
        ]
      }
    ])
  })

  it('keeps repos without a remote apart per host', () => {
    const result = buildForkClashes(
      [
        host('local', [branch('a', ['x'])], null),
        host('runtime:alpha', [branch('b', ['x'])], null)
      ],
      20,
      5
    )
    expect(result.projects).toEqual([])
  })

  it('lists behind branches and flags the stale ones', () => {
    const result = buildForkClashes(
      [host('local', [branch('a', [], 3), branch('b', [], 25)])],
      20,
      5
    )
    expect(result.projects[0].behind.map((entry) => [entry.branch, entry.stale])).toEqual([
      ['b', true],
      ['a', false]
    ])
  })

  it('bounds the shared file list', () => {
    const files = Array.from({ length: FORK_CLASHES_MAX_FILES_PER_PROJECT + 5 }, (_, i) => `f${i}`)
    const result = buildForkClashes(
      [host('local', [branch('a', files), branch('b', files)])],
      20,
      5
    )
    expect(result.projects[0].files).toHaveLength(FORK_CLASHES_MAX_FILES_PER_PROJECT)
    expect(result.projects[0].filesTruncated).toBe(true)
  })
})

describe('forkClashRowMarks', () => {
  it('marks each participant with the other branches, naming other hosts', () => {
    const result = buildForkClashes(
      [host('local', [branch('a', ['x'])]), host('runtime:alpha', [branch('b', ['x'], 30)])],
      20,
      5
    )
    const marks = forkClashRowMarks(result)
    expect(marks.get(forkClashRowKey('local', '/w/a'))).toEqual({
      files: [{ file: 'x', others: ['b @ alpha'] }],
      behind: null,
      stale: false
    })
    expect(marks.get(forkClashRowKey('runtime:alpha', '/w/b'))).toEqual({
      files: [{ file: 'x', others: ['a @ this machine'] }],
      behind: 30,
      stale: true
    })
  })
})

describe('forkClashRepoMatches', () => {
  it('matches a name, an id or the end of a remote key', () => {
    const repo = { repoId: 'id-1', name: 'Orca', projectKey: 'github.com/o/orca' }
    expect(forkClashRepoMatches(repo, 'orca')).toBe(true)
    expect(forkClashRepoMatches(repo, 'id-1')).toBe(true)
    expect(forkClashRepoMatches(repo, 'o/orca')).toBe(true)
    expect(forkClashRepoMatches(repo, 'rca')).toBe(false)
  })
})
