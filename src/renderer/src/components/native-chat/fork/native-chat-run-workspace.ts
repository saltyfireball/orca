import type { ExecutionHostId } from '../../../../../shared/execution-host'
import { selectKnownWorktreeById } from '@/store/workspaces/selection/known-worktree-selection'
import { resolveOwner } from '@/lib/workspace/ownership/resolve-owner'
import { hostRouteForAuthority } from '@/runtime/rpc/targets/runtime-client-target'
import type { NativeChatRunPlace } from './native-chat-run-target'

export type NativeChatRunWorkspace = { hostId: ExecutionHostId | null; displayName: string }

type NativeChatRunState = Parameters<typeof selectKnownWorktreeById>[0] &
  Parameters<typeof resolveOwner>[0]

/**
 * The chat's workspace, git worktree or folder (local or over SSH), on `hostId`. Without a host it
 * answers for the copy the user selected, and null when the workspace is gone or a twin is unpicked.
 */
export function findNativeChatRunWorkspace(
  state: Parameters<typeof selectKnownWorktreeById>[0],
  worktreeId: string,
  hostId?: ExecutionHostId | null
): NativeChatRunWorkspace | null {
  const row = selectKnownWorktreeById(state, worktreeId, hostId ?? undefined)
  return row ? { hostId: row.hostId ?? hostId ?? null, displayName: row.displayName } : null
}

/** The workspace's row host and complete owner route on `hostId` (or the selected copy). */
export function readNativeChatRunPlace(
  state: NativeChatRunState,
  worktreeId: string,
  hostId?: ExecutionHostId | null
): NativeChatRunPlace | null {
  const workspace = findNativeChatRunWorkspace(state, worktreeId, hostId)
  if (!workspace) {
    return null
  }
  const owner = resolveOwner(state, { workspaceId: worktreeId, ...(hostId ? { hostId } : {}) })
  return {
    hostId: workspace.hostId,
    route: owner.kind === 'resolved' ? hostRouteForAuthority(owner.owner) : null
  }
}
