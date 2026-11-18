import { describe, expect, it } from 'vitest'
import { getProjectIdentityKey } from '../../../../../src/shared/project/host-setup/project-host-setup-projection'
import type { MobileWorkspaceRepo } from '../../../new-workspace/creation/forms/new-worktree-modal-types'
import {
  findMobileForkSetUpRepo,
  isMobileForkServerSetupItem,
  mobileForkServerSetupHosts,
  mobileForkServerSetupUrl
} from './mobile-fork-server-setup-rows'

const remote = (remoteUrl: string) => ({
  canonicalKey: remoteUrl.includes('other') ? 'github.com/o/other' : 'github.com/o/r',
  remoteName: 'origin',
  remoteUrl
})

function repo(
  id: string,
  executionHostId: MobileWorkspaceRepo['executionHostId'],
  url = 'git@github.com:o/r.git'
): MobileWorkspaceRepo {
  return {
    id,
    displayName: 'r',
    path: `/x/${id}`,
    executionHostId,
    gitRemoteIdentity: remote(url)
  }
}

const desktop = repo('r1', 'local')
const projectId = getProjectIdentityKey(desktop)
const otherProject = repo('r9', 'runtime:a', 'git@github.com:o/other.git')

describe('mobileForkServerSetupHosts', () => {
  it('offers listed servers that lack the project, never unlisted or local ones', () => {
    const hosts = mobileForkServerSetupHosts({
      serverHostIds: ['runtime:a', 'runtime:b', 'runtime:c'],
      listedHostIds: new Set<string>(['runtime:a', 'runtime:b']),
      repos: [desktop, otherProject, repo('r2', 'runtime:b')],
      projectId
    })
    expect(hosts).toEqual(['runtime:a'])
  })

  it('offers nothing without a project', () => {
    expect(
      mobileForkServerSetupHosts({
        serverHostIds: ['runtime:a'],
        listedHostIds: new Set<string>(['runtime:a']),
        repos: [desktop],
        projectId: null
      })
    ).toEqual([])
  })
})

describe('mobileForkServerSetupUrl', () => {
  it('takes a clonable remote of the project only', () => {
    expect(mobileForkServerSetupUrl([otherProject, desktop], projectId)).toBe(
      'git@github.com:o/r.git'
    )
    expect(mobileForkServerSetupUrl([desktop], null)).toBe('')
  })

  it('refuses a local-path remote', () => {
    const local = repo('r3', 'local', '/srv/git/r.git')
    expect(mobileForkServerSetupUrl([local], getProjectIdentityKey(local))).toBe('')
  })
})

describe('rows', () => {
  it('tells setup rows from run targets', () => {
    expect(
      isMobileForkServerSetupItem({
        id: 'fork-setup:runtime:a',
        label: 'x',
        detail: 'y',
        hostId: 'runtime:a',
        forkServerSetup: true
      })
    ).toBe(true)
    expect(
      isMobileForkServerSetupItem({
        id: 'local',
        hostId: 'local',
        label: 'This Mac',
        detail: '/x/r1',
        repo: desktop
      })
    ).toBe(false)
  })

  it('finds the repo a setup produced on its server', () => {
    const made = repo('r5', 'runtime:a')
    expect(findMobileForkSetUpRepo([desktop, made], 'runtime:a', projectId)).toBe(made)
    expect(findMobileForkSetUpRepo([desktop], 'runtime:a', projectId)).toBeUndefined()
  })
})
