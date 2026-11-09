import { describe, expect, it } from 'vitest'
import { TEST_REPO } from '@/store/repos/repo.test-fixture'
import { makeFolderWorkspace } from '@/store/folder-workspaces/folder-workspace.test-fixture'
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
import { findNativeChatRunWorkspace, readNativeChatRunPlace } from './native-chat-run-workspace'

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    repos: [TEST_REPO],
    projectGroups: [{ id: 'group-1' }, { id: 'remote-group', executionHostId: 'ssh:box' as const }],
    worktreesByRepo: {
      repo1: [makeWorktree({ id: 'repo1::/wt', repoId: 'repo1', displayName: 'feature' })]
    },
    folderWorkspaces: [
      makeFolderWorkspace({ id: 'notes', name: 'notes', executionHostId: 'local' }),
      makeFolderWorkspace({ id: 'remote', name: 'remote notes', projectGroupId: 'remote-group' })
    ],
    detectedWorktreesByRepo: {},
    floatingWorkspacePath: null,
    activeWorktreeId: null,
    activeWorkspaceExecutionHostId: null,
    ...overrides
  }
}

describe('findNativeChatRunWorkspace', () => {
  it('finds a git worktree', () => {
    expect(findNativeChatRunWorkspace(makeState(), 'repo1::/wt')).toEqual({
      hostId: null,
      displayName: 'feature'
    })
  })

  it('finds a local folder workspace on its host', () => {
    const state = makeState()
    expect(findNativeChatRunWorkspace(state, 'folder:notes')).toEqual({
      hostId: 'local',
      displayName: 'notes'
    })
    expect(findNativeChatRunWorkspace(state, 'folder:notes', 'local')).toEqual({
      hostId: 'local',
      displayName: 'notes'
    })
  })

  it('finds a folder workspace over SSH only on that host', () => {
    const state = makeState()
    expect(findNativeChatRunWorkspace(state, 'folder:remote', 'ssh:box')).toEqual({
      hostId: 'ssh:box',
      displayName: 'remote notes'
    })
    expect(findNativeChatRunWorkspace(state, 'folder:remote', 'local')).toBeNull()
  })

  it('reads a different place once the selected folder twin swaps from local to SSH', () => {
    const twins = {
      folderWorkspaces: [
        makeFolderWorkspace({ id: 'twin', name: 'twin', executionHostId: 'local' }),
        makeFolderWorkspace({ id: 'twin', name: 'twin', projectGroupId: 'remote-group' })
      ],
      activeWorktreeId: 'folder:twin'
    }
    const onLocal = makeState({ ...twins, activeWorkspaceExecutionHostId: 'local' })
    const onSsh = makeState({ ...twins, activeWorkspaceExecutionHostId: 'ssh:box' })
    expect(readNativeChatRunPlace(onLocal, 'folder:twin')).toEqual({
      hostId: 'local',
      route: { target: { kind: 'local' }, at: 'local' }
    })
    expect(readNativeChatRunPlace(onSsh, 'folder:twin')).toEqual({
      hostId: 'ssh:box',
      route: { target: { kind: 'local' }, at: 'ssh:box' }
    })
    expect(readNativeChatRunPlace(onSsh, 'folder:twin', 'local')).toEqual({
      hostId: 'local',
      route: { target: { kind: 'local' }, at: 'local' }
    })
  })

  it('answers null once the workspace is gone', () => {
    const state = makeState({ worktreesByRepo: { repo1: [] }, folderWorkspaces: [] })
    expect(findNativeChatRunWorkspace(state, 'repo1::/wt')).toBeNull()
    expect(findNativeChatRunWorkspace(state, 'folder:notes', 'local')).toBeNull()
  })
})
