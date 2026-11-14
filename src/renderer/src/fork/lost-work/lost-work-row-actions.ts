// SLRM-2096, SLRM-2230 (FORK.md "Lost work"): which actions a row offers, and the one to try
// first. Pure, so every rule is tested without the store.
import type { LostWorkItem } from '../../../../shared/fork/lost-work'

export type LostWorkRowAction = 'open' | 'push' | 'pull-request' | 'bundle' | 'patch' | 'delete'

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

/** The actions a row shows, in their usual order. */
export function lostWorkRowActions(item: LostWorkItem): LostWorkRowAction[] {
  const actions: LostWorkRowAction[] = []
  if (canOpenLostWork(item)) {
    actions.push('open')
  }
  if (canPushLostWork(item)) {
    actions.push('push', 'pull-request')
  }
  if (item.kind !== 'stash') {
    actions.push('bundle')
  }
  actions.push('patch', 'delete')
  return actions
}

/**
 * SLRM-2230: the next step for a row, from why it is listed. The first rule that fits wins:
 * work that exists nowhere else is kept before anything is merged or removed.
 */
export function suggestLostWorkAction(item: LostWorkItem): LostWorkRowAction {
  const has = (reason: LostWorkItem['reasons'][number]) => item.reasons.includes(reason)
  if (item.kind === 'missing-folder') {
    return 'delete'
  }
  if (item.kind === 'stash') {
    return 'patch'
  }
  if (item.inUse && canOpenLostWork(item)) {
    return 'open'
  }
  if (has('dirty-files')) {
    return canOpenLostWork(item) ? 'open' : 'patch'
  }
  if (has('unmerged-commits')) {
    const pushed = item.unpushedCommits === 0
    if (!pushed) {
      return canPushLostWork(item) ? 'push' : 'bundle'
    }
    // On a remote but not merged: look at its pull request, or open one.
    return canPushLostWork(item) ? 'pull-request' : 'bundle'
  }
  if (has('pr-open')) {
    return 'pull-request'
  }
  if (has('merged') || has('squash-merged') || has('pr-merged') || has('pr-closed')) {
    return 'delete'
  }
  if (canOpenLostWork(item)) {
    return 'open'
  }
  return canSaveLostWork(item) ? 'patch' : 'delete'
}
