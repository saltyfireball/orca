import type { ExecutionHostId } from '../../../../../shared/execution-host'
import { selectKnownWorktreeById } from '@/store/selectors'

export type NativeChatRunWorkspace = { hostId: ExecutionHostId | null; displayName: string }

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
