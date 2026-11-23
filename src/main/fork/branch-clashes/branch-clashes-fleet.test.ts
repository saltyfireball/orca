import { describe, expect, it, vi } from 'vitest'
import {
  readForkBranchClashConfig,
  type ForkClashHostReport
} from '../../../shared/fork/branch-clashes'
import {
  gatherForkClashes,
  parseForkClashReport,
  type ForkClashFleetDeps
} from './branch-clashes-fleet'

const branch = (name: string, files: string[]) => ({
  worktreeId: `r::/w/${name}`,
  path: `/w/${name}`,
  branch: name,
  head: 'b'.repeat(40),
  ahead: 1,
  behind: 0,
  files,
  filesTruncated: false
})

const report = (name: string, files: string[]): ForkClashHostReport => ({
  repos: [
    {
      repoId: 'r',
      name: 'orca',
      projectKey: 'github.com/o/orca',
      baseRef: 'origin/main',
      branches: [branch(name, files)]
    }
  ]
})

function deps(overrides: Partial<ForkClashFleetDeps> = {}): ForkClashFleetDeps {
  return {
    config: () => readForkBranchClashConfig({}),
    localReport: async () => report('local-branch', ['x.ts']),
    listEnvironments: () => [
      { id: 'alpha', name: 'alpha' },
      { id: 'old', name: 'old' },
      { id: 'down', name: 'down' },
      { id: 'quiet', name: 'quiet' }
    ],
    callEnvironment: async (id) => {
      if (id === 'alpha') {
        return report('alpha-branch', ['x.ts'])
      }
      if (id === 'old') {
        throw Object.assign(new Error('no'), { code: 'method_not_found' })
      }
      if (id === 'quiet') {
        return { off: true, repos: [] }
      }
      throw new Error('timeout')
    },
    now: () => 7,
    ...overrides
  }
}

describe('gatherForkClashes', () => {
  it('asks each paired server for its own branches and folds them with this machine', async () => {
    const result = await gatherForkClashes(deps(), undefined)
    expect(result.projects[0].files[0].participants.map((p) => p.branch)).toEqual([
      'local-branch',
      'alpha-branch'
    ])
    expect(result.hosts.map((h) => [h.hostName, h.status])).toEqual([
      ['this machine', 'ok'],
      ['alpha', 'ok'],
      ['old', 'no-clashes'],
      ['down', 'unreachable'],
      ['quiet', 'off']
    ])
  })

  it('asks no server when paired servers are switched off, and passes the project on', async () => {
    const callEnvironment = vi.fn()
    await gatherForkClashes(
      deps({
        config: () => readForkBranchClashConfig({ forkBranchClashesPairedServers: false }),
        callEnvironment
      }),
      undefined
    )
    expect(callEnvironment).not.toHaveBeenCalled()
    const asked = vi.fn(async () => ({ repos: [] }))
    await gatherForkClashes(deps({ callEnvironment: asked }), 'orca')
    expect(asked).toHaveBeenCalledWith('alpha', 'fork.clashes.local', { project: 'orca' }, 60_000)
  })
})

describe('parseForkClashReport', () => {
  it('drops malformed repos and branches instead of trusting them', () => {
    const parsed = parseForkClashReport({
      repos: [
        null,
        { repoId: 1 },
        {
          repoId: 'r',
          name: 'n',
          projectKey: 5,
          branches: [branch('ok', ['a']), { ...branch('bad', ['a']), files: [3] }, null]
        }
      ]
    })
    expect(parsed?.repos).toEqual([
      expect.objectContaining({ repoId: 'r', projectKey: null, branches: [branch('ok', ['a'])] })
    ])
    expect(parseForkClashReport('nope')).toBeNull()
  })
})
