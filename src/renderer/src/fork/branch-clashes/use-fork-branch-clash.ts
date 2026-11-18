// Branch clashes (FORK.md, SLRM-2394): the mark of one workspace row, found by its host and path,
// so a workspace on a paired server matches what that server reported.
import { useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { findWorktreeById } from '@/store/github/refresh/worktree-refresh'
import {
  LOCAL_EXECUTION_HOST_ID,
  normalizeExecutionHostId,
  toRuntimeExecutionHostId
} from '../../../../shared/execution-host/execution-host'
import {
  forkClashRowKey,
  readForkBranchClashConfig,
  type ForkClashRowMark
} from '../../../../shared/fork/branch-clashes'
import { readForkClashMarks, subscribeForkClashes } from './branch-clashes-client'

/** The row key of a workspace, or '' when it is unknown or the warning is off. */
export function forkClashKeyOf(state: AppState, worktreeId: string): string {
  if (!readForkBranchClashConfig(state.settings).enabled) {
    return ''
  }
  const worktree = findWorktreeById(state, worktreeId)
  if (!worktree) {
    return ''
  }
  const host = normalizeExecutionHostId(worktree.hostId)
  const owner = worktree.runtimeOwnerEnvironmentId
  const hostId =
    owner && (!host || host === LOCAL_EXECUTION_HOST_ID)
      ? toRuntimeExecutionHostId(owner)
      : (host ?? LOCAL_EXECUTION_HOST_ID)
  return forkClashRowKey(hostId, worktree.path)
}

export function useForkBranchClash(worktreeId: string): ForkClashRowMark | null {
  const marks = useSyncExternalStore(subscribeForkClashes, readForkClashMarks, readForkClashMarks)
  // With no marks at all (the usual case) a store write costs every row nothing more.
  const key = useAppStore((state) => (marks.size === 0 ? '' : forkClashKeyOf(state, worktreeId)))
  return key ? (marks.get(key) ?? null) : null
}
