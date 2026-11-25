import { describe, expect, it } from 'vitest'
import { gateWorkspaceOf, resolveGateWorkspace } from './gate-workspace'

const none = { connectionId: null }

describe('gateWorkspaceOf', () => {
  it('runs a git workspace in its checkout, with its branch', () => {
    expect(
      gateWorkspaceOf(
        { path: '/work/app-feature', git: { branch: 'refs/heads/feature/x' } },
        { kind: 'git', path: '/work/app' },
        none
      )
    ).toEqual({
      target: { cwd: '/work/app-feature', connectionId: null },
      branch: 'feature/x',
      git: true
    })
  })

  it('runs a folder workspace in its folder, with no branch and no pull request', () => {
    expect(
      gateWorkspaceOf(
        { path: '/notes/project', git: { branch: '' } },
        { kind: 'folder', path: '/notes/project' },
        none
      )
    ).toEqual({
      target: { cwd: '/notes/project', connectionId: null },
      branch: null,
      git: false
    })
  })

  it('falls back to the project folder when the folder workspace carries no path of its own', () => {
    expect(
      gateWorkspaceOf({ path: '' }, { kind: 'folder', path: '/notes/project' }, none)?.target.cwd
    ).toBe('/notes/project')
  })

  it('keeps the host the folder lives on', () => {
    const target = gateWorkspaceOf(
      { path: '/srv/notes' },
      { kind: 'folder', path: '/srv/notes' },
      { connectionId: 'conn_1', wslDistro: 'Ubuntu' }
    )?.target
    expect(target).toEqual({ cwd: '/srv/notes', connectionId: 'conn_1', wslDistro: 'Ubuntu' })
  })

  it('is null for an unknown project or an empty path', () => {
    expect(gateWorkspaceOf({ path: '/x' }, undefined, none)).toBeNull()
    expect(gateWorkspaceOf({ path: '' }, { kind: 'git', path: '/x' }, none)).toBeNull()
  })
})

describe('resolveGateWorkspace', () => {
  it('resolves a folder project workspace to its real folder', async () => {
    const runtime = {
      resolveRuntimeFileTarget: async (selector: string) => {
        expect(selector).toBe('id:wt_folder')
        return {
          worktree: { repoId: 'repo_1', path: '/notes/project', git: { branch: '' } },
          executionHostId: 'local' as const
        }
      },
      store: () =>
        ({
          getRepo: () => ({ id: 'repo_1', kind: 'folder', path: '/notes/project' }),
          getSettings: () => ({}),
          getRepos: () => [],
          getProjectGroups: () => []
        }) as never
    }
    const resolved = await resolveGateWorkspace(runtime as never, 'wt_folder')
    expect(resolved?.target.cwd).toBe('/notes/project')
    expect(resolved?.git).toBe(false)
  })

  it('runs a project group folder workspace (folder:<id>) in its folder, inside WSL for a WSL path', async () => {
    const runtime = (path: string) => ({
      resolveRuntimeFileTarget: async () => ({
        worktree: { repoId: 'folder-workspace:group_1', path, git: { branch: '' } },
        executionHostId: 'local' as const
      }),
      store: () => ({ getRepo: () => undefined }) as never
    })
    expect(await resolveGateWorkspace(runtime('/notes/group') as never, 'folder:ws_1')).toEqual({
      target: { cwd: '/notes/group', connectionId: null },
      branch: null,
      git: false
    })
    const wsl = await resolveGateWorkspace(
      runtime('\\\\wsl.localhost\\Ubuntu\\home\\dev\\group') as never,
      'folder:ws_1'
    )
    expect(wsl?.target).toEqual({ cwd: '/home/dev/group', connectionId: null, wslDistro: 'Ubuntu' })
  })

  it('is null for an unknown repo that is not a project group', async () => {
    const runtime = {
      resolveRuntimeFileTarget: async () => ({
        worktree: { repoId: 'repo_gone', path: '/x', git: { branch: '' } },
        executionHostId: 'local' as const
      }),
      store: () => ({ getRepo: () => undefined }) as never
    }
    expect(await resolveGateWorkspace(runtime as never, 'wt_1')).toBeNull()
  })
})
