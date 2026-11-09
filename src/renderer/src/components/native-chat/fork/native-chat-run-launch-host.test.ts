import { describe, expect, it, vi } from 'vitest'
import { createTestStore, seedStore } from '@/store/testing/app-store-test-fixture'
import { createStoreCascadesMockApi } from '@/store/testing/app-store-cascade-api.test-fixture'
import {
  MIXED_FOLDER,
  MIXED_GROUP
} from '../../../../../shared/folder-workspaces/folder-workspace-host-routing.test-fixture'
import { resolveTerminalPaneOwnerContext } from '@/components/terminal-pane/host-state/terminal-pane-owner-context'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}))
vi.mock('@/components/terminal-pane/pty-transport/delivery/pty-dispatcher', () => ({}))

createStoreCascadesMockApi()

describe('Run launch host', () => {
  it('opens the tab on the captured twin while the other twin is selected', () => {
    const store = createTestStore()
    const localFolder = {
      ...MIXED_FOLDER,
      folderPath: '/work/local',
      executionHostId: 'local' as const
    }
    const sshFolder = {
      ...MIXED_FOLDER,
      folderPath: '/work/remote',
      executionHostId: 'ssh:prod' as const
    }
    const worktreeId = `folder:${MIXED_FOLDER.id}`
    seedStore(store, {
      activeWorktreeId: worktreeId,
      activeWorkspaceExecutionHostId: 'ssh:prod',
      folderWorkspaces: [localFolder, sshFolder],
      projectGroups: [MIXED_GROUP]
    })
    const tab = store.getState().createTab(worktreeId, undefined, undefined, {
      executionHostId: 'local'
    })
    const state = store.getState()
    const owner = resolveTerminalPaneOwnerContext(state, worktreeId, tab.id, null)
    expect({
      stamp: state.unifiedTabsByWorktree[worktreeId][0].executionHostId,
      path: owner.worktree?.path,
      host: owner.executionHostId
    }).toEqual({ stamp: 'local', path: '/work/local', host: 'local' })
  })
})
