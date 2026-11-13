// SLRM-2096 (FORK.md "Lost work"): what the Lost work dialog's buttons do. Removing a worktree Orca
// tracks goes through Orca's own guarded removal; every other change is asked of the main process,
// which checks the item against git again before it acts.
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { activateAndRevealWorktree } from '@/lib/workspace/activation/worktree-activation'
import { findWorktreeById } from '@/store/github/refresh/worktree-refresh'
import { toWorktreeRemovalTarget } from '../../../../shared/worktree/removal'
import type {
  LostWorkAction,
  LostWorkActionResult,
  LostWorkItem
} from '../../../../shared/fork/lost-work'

/** How an item is deleted: Orca's workspace removal, or a main-process action. */
export type LostWorkDeletePlan = { kind: 'workspace' } | { kind: 'action'; action: LostWorkAction }

export function lostWorkDeletePlan(item: LostWorkItem, trackedByOrca: boolean): LostWorkDeletePlan {
  switch (item.kind) {
    case 'worktree':
      return { kind: 'workspace' }
    case 'missing-folder':
      // Orca's removal also clears its own record; git alone just forgets the folder.
      return trackedByOrca ? { kind: 'workspace' } : { kind: 'action', action: 'prune-worktree' }
    case 'untracked-worktree':
      return { kind: 'action', action: 'remove-untracked-worktree' }
    case 'branch':
      return { kind: 'action', action: 'delete-branch' }
    case 'stash':
      return { kind: 'action', action: 'drop-stash' }
  }
}

/** Push needs a branch; a stash or detached HEAD has none. */
export function canPushLostWork(item: LostWorkItem): boolean {
  return Boolean(item.branch) && item.kind !== 'missing-folder' && item.kind !== 'stash'
}

export function canSaveLostWork(item: LostWorkItem): boolean {
  return item.kind !== 'missing-folder' || Boolean(item.branch)
}

export function canOpenLostWork(item: LostWorkItem): boolean {
  return item.kind === 'worktree' && Boolean(item.worktreeId)
}

function api() {
  const lostWork = window.api.forkLostWork
  if (!lostWork) {
    throw new Error(translate('fork.lostWork.unavailable', 'Lost work is not available here.'))
  }
  return lostWork
}

export function actOnLostWork(
  item: LostWorkItem,
  action: LostWorkAction,
  extra: { folder?: string; confirmedLoss?: boolean } = {}
): Promise<LostWorkActionResult> {
  return api().act({ action, item, ...extra })
}

function findTracked(item: LostWorkItem) {
  return item.worktreeId ? findWorktreeById(useAppStore.getState(), item.worktreeId) : null
}

export function openLostWorkWorkspace(item: LostWorkItem): void {
  if (item.worktreeId) {
    activateAndRevealWorktree(item.worktreeId, { navigationIntent: 'user-open' })
  }
}

export async function deleteLostWork(
  item: LostWorkItem,
  confirmedLoss: boolean
): Promise<LostWorkActionResult> {
  const tracked = findTracked(item)
  const plan = lostWorkDeletePlan(item, tracked !== null)
  if (plan.kind === 'action') {
    return actOnLostWork(item, plan.action, { confirmedLoss })
  }
  if (!tracked) {
    return {
      ok: false,
      error: translate(
        'fork.lostWork.staleWorkspace',
        'Orca no longer has this workspace. Scan again.'
      )
    }
  }
  // Force only after the loss was confirmed, or when the scan could not read the folder's state.
  const force = confirmedLoss || item.dirtyFiles === null || (item.dirtyFiles ?? 0) > 0
  const result = await useAppStore
    .getState()
    .removeWorktree(toWorktreeRemovalTarget(tracked), force)
  return result.ok ? { ok: true } : { ok: false, error: result.error }
}

/** The settings folder when set, else one the user picks; null when they cancel. */
export async function chooseArchiveFolder(): Promise<string | null> {
  const configured = useAppStore.getState().settings?.forkLostWork?.archiveFolder?.trim()
  if (configured) {
    return configured
  }
  return window.api.shell.pickDirectory({})
}
