import {
  toRuntimeExecutionHostId,
  type ExecutionHostId
} from '../../../../../shared/execution-host'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import type { HostRoute } from '@/runtime/rpc/targets/runtime-client-target'

/** Where a workspace runs right now: its row's host and its owner's transport plus place. */
export type NativeChatRunPlace = { hostId: ExecutionHostId | null; route: HostRoute | null }

/** Where a confirmed Run launches, frozen when its dialog opens. */
export type NativeChatRunTarget = {
  /** The chat's own transport. */
  target: RuntimeClientTarget
  worktreeId: string
  /** The workspace row's host, so a folder twin or SSH copy is checked on that same host. */
  hostId: ExecutionHostId | null
  /** Transport and place together: twins behind one transport differ only in `at`. */
  route: HostRoute
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

export function sameHostRoute(a: HostRoute | null, b: HostRoute | null): boolean {
  return a !== null && b !== null && a.at === b.at && sameRuntimeClientTarget(a.target, b.target)
}

/**
 * True only when the chat still belongs to the captured workspace, and both the captured host's copy
 * and the copy now selected have the captured row host and the exact captured route.
 */
export function isNativeChatRunTargetCurrent({
  captured,
  liveOwner,
  onHost,
  selected
}: {
  captured: NativeChatRunTarget
  liveOwner: { target: RuntimeClientTarget; worktreeId: string } | null
  /** The workspace on the captured host, null when gone. */
  onHost: NativeChatRunPlace | null
  /** The workspace as unqualified lookups resolve it, null when gone or a twin is unpicked. */
  selected: NativeChatRunPlace | null
}): boolean {
  return (
    liveOwner !== null &&
    liveOwner.worktreeId === captured.worktreeId &&
    sameRuntimeClientTarget(liveOwner.target, captured.target) &&
    sameRuntimeClientTarget(captured.route.target, captured.target) &&
    [onHost, selected].every(
      (place) =>
        place !== null &&
        place.hostId === captured.hostId &&
        sameHostRoute(place.route, captured.route)
    )
  )
}

/** The host the new tab is pinned to: the captured row's, else the one its route names. */
export function nativeChatRunLaunchHostId(captured: NativeChatRunTarget): ExecutionHostId {
  const { target, at } = captured.route
  return (
    captured.hostId ??
    (target.kind === 'environment' && at === 'local'
      ? toRuntimeExecutionHostId(target.environmentId)
      : at)
  )
}
