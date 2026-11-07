import { describe, expect, it } from 'vitest'
import {
  TEST_REPO,
  makeFolderWorkspace,
  makeWorktree
} from '@/store/slices/worktrees-slice-test-fixtures'
import { findNativeChatRunWorkspace } from './native-chat-run-workspace'

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

  it('answers null once the workspace is gone', () => {
    const state = makeState({ worktreesByRepo: { repo1: [] }, folderWorkspaces: [] })
    expect(findNativeChatRunWorkspace(state, 'repo1::/wt')).toBeNull()
    expect(findNativeChatRunWorkspace(state, 'folder:notes', 'local')).toBeNull()
  })
})
