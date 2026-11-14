// SLRM-2230 (FORK.md "Lost work"): acting on many rows at once: counts for the filters, rows
// grouped by project, what select all ticks, the confirmations a delete passes, and what a bulk
// action reports. Pure, so each rule is tested without the dialog.
import {
  LOST_WORK_RISK_ORDER,
  type LostWorkItem,
  type LostWorkKind,
  type LostWorkRisk
} from '../../../../shared/fork/lost-work'

export type LostWorkFilter = 'all' | LostWorkRisk

export function lostWorkFilterCounts(
  items: readonly LostWorkItem[]
): Record<LostWorkFilter, number> {
  const counts = { all: items.length, safe: 0, 'needs-look': 0, 'would-lose-work': 0 }
  for (const item of items) {
    counts[item.risk] += 1
  }
  return counts
}

export type LostWorkGroup = { repoId: string; repoName: string; items: LostWorkItem[] }

/** Projects by name; inside each, riskiest first, then the newest commit. */
export function groupLostWorkByProject(items: readonly LostWorkItem[]): LostWorkGroup[] {
  const groups = new Map<string, LostWorkGroup>()
  for (const item of items) {
    const group = groups.get(item.repoId) ?? {
      repoId: item.repoId,
      repoName: item.repoName,
      items: []
    }
    group.items.push(item)
    groups.set(item.repoId, group)
  }
  for (const group of groups.values()) {
    group.items.sort(
      (a, b) =>
        LOST_WORK_RISK_ORDER.indexOf(a.risk) - LOST_WORK_RISK_ORDER.indexOf(b.risk) ||
        (b.lastCommitAt ?? 0) - (a.lastCommitAt ?? 0)
    )
  }
  return [...groups.values()].sort(
    (a, b) => a.repoName.localeCompare(b.repoName) || a.repoId.localeCompare(b.repoId)
  )
}

/** Select all never ticks a row that is in use; such a row is ticked only by hand. */
export function selectableLostWork(items: readonly LostWorkItem[]): LostWorkItem[] {
  return items.filter((item) => !item.inUse)
}

/** A select-all checkbox over `items`: ticked, part-ticked, or clear. */
export function lostWorkSelectAllState(
  items: readonly LostWorkItem[],
  selected: ReadonlySet<string>
): boolean | 'indeterminate' {
  const selectable = selectableLostWork(items)
  const ticked = items.filter((item) => selected.has(item.id)).length
  if (ticked === 0) {
    return false
  }
  const all = selectable.length > 0 && selectable.every((item) => selected.has(item.id))
  return all ? true : 'indeterminate'
}

/** Ticks every selectable row of `items`, or clears all of them when they are already ticked. */
export function toggleLostWorkSelectAll(
  items: readonly LostWorkItem[],
  selected: ReadonlySet<string>
): Set<string> {
  const next = new Set(selected)
  if (lostWorkSelectAllState(items, selected) === true) {
    for (const item of items) {
      next.delete(item.id)
    }
  } else {
    for (const item of selectableLostWork(items)) {
      next.add(item.id)
    }
  }
  return next
}

export function lostWorkKindCounts(items: readonly LostWorkItem[]): Record<LostWorkKind, number> {
  const counts: Record<LostWorkKind, number> = {
    worktree: 0,
    'untracked-worktree': 0,
    'missing-folder': 0,
    branch: 0,
    stash: 0
  }
  for (const item of items) {
    counts[item.kind] += 1
  }
  return counts
}

/** Every delete is confirmed; rows in use and rows that would lose work each ask once more. */
export type LostWorkDeleteStage = 'confirm' | 'in-use' | 'loss'

/** The confirmation after `stage`, or null when the delete may run. */
export function nextLostWorkDeleteStage(
  items: readonly LostWorkItem[],
  stage: LostWorkDeleteStage
): LostWorkDeleteStage | null {
  const losesWork = items.some((item) => item.risk === 'would-lose-work')
  if (stage === 'confirm' && items.some((item) => item.inUse)) {
    return 'in-use'
  }
  return stage !== 'loss' && losesWork ? 'loss' : null
}

export type LostWorkBulkAction = 'delete' | 'push' | 'save'

export type LostWorkBulkSummary = {
  action: LostWorkBulkAction
  done: number
  files: string[]
  refused: { name: string; reason: string }[]
}
