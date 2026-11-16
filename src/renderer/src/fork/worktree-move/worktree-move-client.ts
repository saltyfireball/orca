// SLRM-2265 (FORK.md "Worktree move"): the desktop's side of moving a workspace and its chats to
// another host. It runs the shared runner over this app's runtime transports: the workspace's own
// host for the source half, the chosen host for the target half.
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { createNonSecureContextUuid } from '../../../../shared/non-secure-context-uuid'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { resolveWorktreeMoveSettings } from '../../../../shared/fork/worktree-move/worktree-move-settings'
import {
  runWorktreeMove,
  type WorktreeMoveRunResult
} from '../../../../shared/fork/worktree-move/worktree-move-runner'
import { forkClaudeWorktreeTarget } from '../claude-account-move/fork-claude-move-actions'

/** A move creates a worktree and copies transcripts; give each call room. */
const MOVE_CALL_TIMEOUT_MS = 10 * 60_000

export type WorktreeMoveHostChoice = { hostId: string; label: string }

export function worktreeMoveHostTarget(hostId: string): RuntimeClientTarget | null {
  if (hostId === LOCAL_EXECUTION_HOST_ID) {
    return { kind: 'local' }
  }
  return hostId.startsWith('runtime:')
    ? { kind: 'environment', environmentId: hostId.slice('runtime:'.length) }
    : null
}

export function worktreeMoveTargetHostId(target: RuntimeClientTarget): string {
  return target.kind === 'local' ? LOCAL_EXECUTION_HOST_ID : `runtime:${target.environmentId}`
}

/** The hosts a workspace can move to: this machine and each paired server, minus its own. */
export function worktreeMoveHostChoices(
  environments: readonly { id: string; name: string }[],
  sourceHostId: string | null,
  localLabel: string
): WorktreeMoveHostChoice[] {
  const all = [
    { hostId: LOCAL_EXECUTION_HOST_ID, label: localLabel },
    ...environments.map((entry) => ({ hostId: `runtime:${entry.id}`, label: entry.name }))
  ]
  return all.filter((choice) => choice.hostId !== sourceHostId)
}

export function worktreeMoveSourceHostId(state: AppState, worktreeId: string): string | null {
  const target = forkClaudeWorktreeTarget(state, worktreeId)
  return target ? worktreeMoveTargetHostId(target) : null
}

export type WorktreeMoveRequest = {
  worktreeId: string
  targetHostId: string
  targetLabel: string
}

export async function runDesktopWorktreeMove(
  request: WorktreeMoveRequest,
  options: { stopTurns: boolean; dryRun: boolean }
): Promise<WorktreeMoveRunResult> {
  const state = useAppStore.getState()
  const source = forkClaudeWorktreeTarget(state, request.worktreeId)
  const target = worktreeMoveHostTarget(request.targetHostId)
  if (!source || !target) {
    throw new Error('This host is not served by an Orca runtime, so it cannot move workspaces.')
  }
  return runWorktreeMove({
    call: (side, method, params) =>
      callRuntimeRpc<unknown>(side === 'source' ? source : target, method, params, {
        timeoutMs: MOVE_CALL_TIMEOUT_MS
      }),
    worktree: `id:${request.worktreeId}`,
    sourceHostId: worktreeMoveTargetHostId(source),
    targetHostId: request.targetHostId,
    targetLabel: request.targetLabel,
    settings: resolveWorktreeMoveSettings(state.settings?.forkWorktreeMove),
    stopTurns: options.stopTurns,
    dryRun: options.dryRun,
    randomUuid: createNonSecureContextUuid
  })
}
