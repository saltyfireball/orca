// SLRM-2175 (FORK.md "Lost work"): a running scan reports each repository as it finishes. The list
// takes those rows at once: a project's earlier rows are replaced by its fresh ones, and projects
// still being read keep what the last scan showed until their turn comes.
import type { LostWorkScanProgress, LostWorkScanResult } from '../../../../shared/fork/lost-work'

export type LostWorkProgressLine = Pick<LostWorkScanProgress, 'done' | 'total' | 'current'>

export function mergeLostWorkProgress(
  previous: LostWorkScanResult | null,
  finished: NonNullable<LostWorkScanProgress['finished']>,
  now: number
): LostWorkScanResult {
  const ids = new Set(finished.repoIds)
  return {
    scannedAt: previous?.scannedAt ?? now,
    items: [...(previous?.items ?? []).filter((item) => !ids.has(item.repoId)), ...finished.items],
    notes: [...(previous?.notes ?? []).filter((note) => !ids.has(note.repoId)), ...finished.notes]
  }
}

/** The project named on the progress line, with a count when more are being read beside it. */
export function lostWorkProgressName(current: readonly string[]): string {
  if (current.length === 0) {
    return ''
  }
  return current.length === 1 ? current[0] : `${current[0]} +${current.length - 1}`
}
