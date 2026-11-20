import { describe, expect, it, vi } from 'vitest'
import { createTestStore } from '@/store/testing/app-store-test-fixture'
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
import {
  resolveNativeChatAttachmentOwnerForWorktree,
  resolveNativeChatRuntimeSessionAttachmentOwner
} from './native-chat-attachment-owner'

const revisions = vi.hoisted(() => new Map<string, number>())
vi.mock(
  '../../../../runtime/rpc/environment-revisions/runtime-environment-revision',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    getRuntimeEnvironmentRevision: (id: string) => revisions.get(id)
  })
)

const WORKTREE_ID = 'repoPaired::/srv/proj/paired'

describe('resolveNativeChatAttachmentOwnerForWorktree', () => {
  it('names the paired server for a worktree it owns', () => {
    const store = createTestStore()
    store.setState({
      repos: [
        { id: 'repoPaired', path: '/srv/proj', displayName: 'p', badgeColor: '#000', addedAt: 0 }
      ] as never,
      worktreesByRepo: {
        repoPaired: [
          makeWorktree({
            id: WORKTREE_ID,
            repoId: 'repoPaired',
            path: '/srv/proj/paired',
            hostId: 'runtime:env-1'
          } as never)
        ]
      }
    })
    expect(resolveNativeChatAttachmentOwnerForWorktree(store.getState(), WORKTREE_ID)).toEqual({
      kind: 'remote',
      clipboardImageEnvironmentId: 'env-1',
      staging: {
        environmentId: 'env-1',
        worktreeId: WORKTREE_ID,
        executionHostId: 'runtime:env-1'
      }
    })
  })

  it('uploads a structured chat on a paired server to that server, never a local path', () => {
    revisions.set('env-1', 3)
    expect(
      resolveNativeChatRuntimeSessionAttachmentOwner({
        sessionId: 's1',
        runtimeEnvironmentId: 'env-1'
      })
    ).toEqual({
      kind: 'runtime-session',
      environmentId: 'env-1',
      pairingRevision: 3,
      sessionId: 's1'
    })
    expect(
      resolveNativeChatRuntimeSessionAttachmentOwner({
        sessionId: 's1',
        runtimeEnvironmentId: 'unpaired'
      })
    ).toEqual({ kind: 'not-ready' })
  })
})
