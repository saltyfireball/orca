import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'

/** Where a confirmed Run launches, frozen when its dialog opens. */
export type NativeChatRunTarget = {
  target: RuntimeClientTarget
  worktreeId: string
  /** The workspace row's host, so a folder twin or SSH copy is checked on that same host. */
  hostId: ExecutionHostId | null
  groupId: string | null
}

export function sameRuntimeClientTarget(
  a: RuntimeClientTarget | null | undefined,
  b: RuntimeClientTarget | null | undefined
): boolean {
  if (!a || !b || a.kind !== b.kind) {
    return false
  }
  return a.kind === 'local' || (b.kind === 'environment' && a.environmentId === b.environmentId)
}

/**
 * True only when the chat still belongs to the captured workspace on the captured host, and that
 * workspace still exists and resolves to exactly that host, so a new tab lands where the user agreed.
 */
export function isNativeChatRunTargetCurrent({
  captured,
  liveOwner,
  worktreeExists,
  resolvedTarget
}: {
  captured: NativeChatRunTarget
  liveOwner: { target: RuntimeClientTarget; worktreeId: string } | null
  worktreeExists: boolean
  /** The worktree's owner as terminals resolve it, null when unresolved or ambiguous. */
  resolvedTarget: RuntimeClientTarget | null
}): boolean {
  return (
    worktreeExists &&
    liveOwner !== null &&
    liveOwner.worktreeId === captured.worktreeId &&
    sameRuntimeClientTarget(liveOwner.target, captured.target) &&
    sameRuntimeClientTarget(resolvedTarget, captured.target)
  )
}
