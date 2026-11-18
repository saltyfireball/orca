import { describe, expect, it, vi } from 'vitest'
import type { Project } from '../../../shared/project/project-types'
import type { Repo } from '../../../shared/repository/repo-types'
import { findForkProject, runForkServerSetupOnEnvironment } from './server-setup-run'

const PROJECT = {
  id: 'github:o/repo',
  displayName: 'Repo',
  sourceRepoIds: ['r1'],
  providerIdentity: { provider: 'github', owner: 'o', repo: 'repo' }
} as unknown as Project

const REPOS = [
  { id: 'r1', gitRemoteIdentity: { remoteUrl: 'git@github.com:o/repo.git' } }
] as unknown as Repo[]

/** A paired server that answers like a Blackfish with on-demand setup. */
function fakeServer(answers: Record<string, unknown> = {}) {
  return vi.fn(async (_environmentId: string, method: string, params: unknown) => {
    if (method in answers) {
      const answer = answers[method]
      if (answer instanceof Error) {
        throw answer
      }
      return answer
    }
    switch (method) {
      case 'fork.placement.load':
        return { load: {}, projectReady: false }
      case 'fork.serverSetup.plan':
        return {
          destination: '/home/s/development',
          folderName: 'repo',
          clonePath: '/home/s/development/repo',
          exists: false
        }
      case 'repo.clone':
        return { repo: { path: '/home/s/development/repo' } }
      case 'projectHostSetup.setupExistingFolder':
        return { result: {} }
      case 'fork.serverSetup.readiness':
        return { missing: ['pnpm'], notes: [] }
      default:
        throw new Error(`unexpected ${method} ${JSON.stringify(params)}`)
    }
  })
}

function deps(callEnvironment: ReturnType<typeof fakeServer>, settings = {}) {
  return {
    settings: () => settings,
    listEnvironments: () => [{ id: 'env-1', name: 'build box' }],
    listProjects: () => [PROJECT],
    listRepos: () => REPOS,
    callEnvironment
  }
}

describe('runForkServerSetupOnEnvironment', () => {
  it('clones and registers the project on the server, then reads readiness', async () => {
    const call = fakeServer()
    const result = await runForkServerSetupOnEnvironment(deps(call), {
      environmentId: 'env-1',
      project: 'Repo'
    })
    expect(result).toEqual({
      hostKey: 'runtime:env-1',
      serverName: 'build box',
      cloned: true,
      clonePath: '/home/s/development/repo',
      readiness: { missing: ['pnpm'], notes: [] }
    })
    expect(call.mock.calls.map((entry) => entry[1])).toEqual([
      'fork.placement.load',
      'fork.serverSetup.plan',
      'repo.clone',
      'projectHostSetup.setupExistingFolder',
      'fork.serverSetup.readiness'
    ])
    expect(call).toHaveBeenCalledWith(
      'env-1',
      'fork.serverSetup.plan',
      { url: 'git@github.com:o/repo.git', parent: '~/development' },
      15_000
    )
    expect(call).toHaveBeenCalledWith(
      'env-1',
      'repo.clone',
      {
        url: 'git@github.com:o/repo.git',
        destination: '/home/s/development',
        folderName: 'repo'
      },
      600_000
    )
    expect(call).toHaveBeenCalledWith(
      'env-1',
      'projectHostSetup.setupExistingFolder',
      {
        projectId: 'github:o/repo',
        projectProviderIdentity: { provider: 'github', owner: 'o', repo: 'repo' },
        hostId: 'runtime:env-1',
        path: '/home/s/development/repo',
        kind: 'git',
        displayName: 'Repo',
        setupMethod: 'cloned'
      },
      15_000
    )
  })

  it('does nothing when the server already has the project', async () => {
    const call = fakeServer({ 'fork.placement.load': { load: {}, projectReady: true } })
    const result = await runForkServerSetupOnEnvironment(deps(call), {
      environmentId: 'env-1',
      project: 'github:o/repo'
    })
    expect(result.cloned).toBe(false)
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('uses the parent setting and skips readiness when it is off', async () => {
    const call = fakeServer()
    await runForkServerSetupOnEnvironment(
      deps(call, { forkServerSetupParent: '/srv/code', forkServerSetupReadiness: false }),
      { environmentId: 'env-1', project: 'Repo' }
    )
    expect(call).toHaveBeenCalledWith(
      'env-1',
      'fork.serverSetup.plan',
      { url: 'git@github.com:o/repo.git', parent: '/srv/code' },
      15_000
    )
    expect(call.mock.calls.map((entry) => entry[1])).not.toContain('fork.serverSetup.readiness')
  })

  it('skips readiness when the caller checks it itself (SLRM-2406)', async () => {
    const call = fakeServer()
    const result = await runForkServerSetupOnEnvironment(deps(call), {
      environmentId: 'env-1',
      project: 'Repo',
      skipReadiness: true
    })
    expect(result.cloned).toBe(true)
    expect(result.readiness).toBeNull()
    expect(call.mock.calls.map((entry) => entry[1])).not.toContain('fork.serverSetup.readiness')
  })

  it('refuses an unknown server or project', async () => {
    const call = fakeServer()
    await expect(
      runForkServerSetupOnEnvironment(deps(call), { environmentId: 'nope', project: 'Repo' })
    ).rejects.toThrow(/No paired server/)
    await expect(
      runForkServerSetupOnEnvironment(deps(call), { environmentId: 'env-1', project: 'Other' })
    ).rejects.toThrow(/No project here/)
    expect(call).not.toHaveBeenCalled()
  })

  it('reports a failed readiness check as a note, keeping the setup', async () => {
    const call = fakeServer({ 'fork.serverSetup.readiness': new Error('timed out') })
    const result = await runForkServerSetupOnEnvironment(deps(call), {
      environmentId: 'env-1',
      project: 'Repo'
    })
    expect(result.readiness).toEqual({ missing: [], notes: ['Readiness check failed: timed out'] })
  })
})

describe('findForkProject', () => {
  it('matches an id, else exactly one display name', () => {
    const other = { ...PROJECT, id: 'p2', displayName: 'repo' } as Project
    expect(findForkProject([PROJECT], 'github:o/repo')).toBe(PROJECT)
    expect(findForkProject([PROJECT], 'repo')).toBe(PROJECT)
    expect(findForkProject([PROJECT, other], 'Repo')).toBeUndefined()
  })
})
