// SLRM-2096: what deleting an item would cost, from the facts the scan read. Pure, so every rule
// is tested without git.
import type {
  LostWorkKind,
  LostWorkPullRequest,
  LostWorkReason,
  LostWorkRisk
} from '../../../shared/fork/lost-work'

export type LostWorkFacts = {
  kind: LostWorkKind
  detached?: boolean
  dirtyFiles: number | null
  /** Commits not on the base by patch-id; null when there is no base or git failed. */
  unmergedCommits: number | null
  /** Unmerged commits on no remote either. */
  unpushedCommits: number | null
  squashMerged: boolean | null
  pullRequest?: LostWorkPullRequest
  /** For a merged pull request: commits made after its head that the base lacks. */
  commitsPastPullRequest?: number | null
}

export type LostWorkClassification = {
  risk: LostWorkRisk
  reasons: LostWorkReason[]
  /** Unmerged commits once squash and pull request merges are taken into account. */
  unmergedCommits: number | null
  /** True when every commit is on the base, so the worktree is finished work. */
  finished: boolean
}

const RANK: Record<LostWorkRisk, number> = { safe: 0, 'needs-look': 1, 'would-lose-work': 2 }

function atLeast(current: LostWorkRisk, next: LostWorkRisk): LostWorkRisk {
  return RANK[next] > RANK[current] ? next : current
}

export function classifyLostWork(facts: LostWorkFacts): LostWorkClassification {
  const reasons: LostWorkReason[] = []
  let risk: LostWorkRisk = 'safe'
  if (facts.kind === 'stash') {
    // Dropping a stash loses its changes; it exists nowhere else.
    return { risk: 'would-lose-work', reasons: ['stash'], unmergedCommits: null, finished: false }
  }
  if (facts.kind === 'untracked-worktree') {
    reasons.push('not-tracked')
  }
  if (facts.kind === 'missing-folder') {
    reasons.push('folder-missing')
  }
  if (facts.detached) {
    reasons.push('detached-head')
  }

  let unmerged = facts.unmergedCommits
  const pr = facts.pullRequest
  if (pr?.state === 'merged' && facts.commitsPastPullRequest !== undefined) {
    reasons.push('pr-merged')
    // Only commits made after the merged head can still be missing from the base.
    unmerged =
      facts.commitsPastPullRequest === null
        ? unmerged
        : Math.min(unmerged ?? facts.commitsPastPullRequest, facts.commitsPastPullRequest)
  } else if (pr?.state === 'merged') {
    reasons.push('pr-merged')
  }
  if (unmerged !== null && unmerged > 0 && facts.squashMerged === true) {
    reasons.push('squash-merged')
    unmerged = 0
  } else if (unmerged === 0 && pr?.state !== 'merged') {
    reasons.push('merged')
  }

  if (unmerged === null) {
    reasons.push('unknown-base')
    risk = atLeast(risk, 'needs-look')
  } else if (unmerged > 0) {
    reasons.push('unmerged-commits')
    const unpushed = facts.unpushedCommits
    if (unpushed === null || unpushed > 0) {
      if (unpushed !== null) {
        reasons.push('unpushed-commits')
      }
      risk = atLeast(risk, 'would-lose-work')
    } else if (pr?.state !== 'closed') {
      // Every commit is on a remote, but nothing merged it: someone should decide.
      risk = atLeast(risk, 'needs-look')
    }
  }
  if (pr?.state === 'closed') {
    reasons.push('pr-closed')
  }
  if (pr?.state === 'open') {
    reasons.push('pr-open')
    risk = atLeast(risk, 'needs-look')
  }
  if (facts.dirtyFiles !== null && facts.dirtyFiles > 0) {
    reasons.push('dirty-files')
    risk = atLeast(risk, 'would-lose-work')
  }
  if (facts.dirtyFiles === null && facts.kind !== 'branch' && facts.kind !== 'missing-folder') {
    risk = atLeast(risk, 'needs-look')
  }
  if (facts.kind === 'missing-folder') {
    // Pruning drops only git's record of a folder that is gone; the branch stays.
    risk = 'safe'
  }
  const finished = unmerged === 0 || (pr?.state === 'closed' && risk === 'safe')
  return { risk, reasons, unmergedCommits: unmerged, finished }
}
