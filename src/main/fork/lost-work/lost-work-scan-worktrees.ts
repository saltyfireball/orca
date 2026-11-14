// SLRM-2096: the lost work scan's worktree pass: every linked worktree with what it would lose.
// Read-only. SLRM-2175: a worktree is listed under one project even when several projects are
// worktrees of the same repository.
import type { GitWorktreeInfo } from '../../../shared/worktree/types'
import { composeWorktreeId } from '../../../shared/worktree/id'
import type { LostWorkItem, LostWorkKind } from '../../../shared/fork/lost-work'
import { throwIfWorkspaceCleanupScanAborted } from '../../ipc/workspace-cleanup/workspace-cleanup-scan-primitives'
import { classifyLostWork, type LostWorkClassification } from './lost-work-classify'
import { countDirtyFiles, readLastCommitAt, shortBranchName } from './lost-work-git'
import { readTipFacts, type RepoScan } from './lost-work-scan-refs'

async function worktreeKind(
  scan: RepoScan,
  worktree: GitWorktreeInfo,
  worktreeId: string
): Promise<LostWorkKind> {
  if (worktree.prunable || !(await scan.deps.pathExists(worktree.path))) {
    return 'missing-folder'
  }
  return scan.deps.isTracked(worktreeId) ? 'worktree' : 'untracked-worktree'
}

function wantsWorktree(
  scan: RepoScan,
  kind: LostWorkKind,
  classification: LostWorkClassification
): boolean {
  const { checks } = scan.settings
  if (kind === 'missing-folder') {
    return checks.missingFolders
  }
  if (kind === 'untracked-worktree' && checks.untrackedWorktrees) {
    return true
  }
  return classification.finished ? checks.finishedWorktrees : checks.unmergedWorktrees
}

/**
 * Every linked worktree, each listed under the project `scanFor` gives it. `shared` holds the
 * settings and the limiter all of those scans share.
 */
export async function scanWorktrees(
  shared: RepoScan,
  worktrees: readonly GitWorktreeInfo[],
  scanFor: (worktree: GitWorktreeInfo) => RepoScan
): Promise<LostWorkItem[]> {
  const checks = shared.settings.checks
  if (
    !checks.unmergedWorktrees &&
    !checks.finishedWorktrees &&
    !checks.untrackedWorktrees &&
    !checks.missingFolders
  ) {
    return []
  }
  const linked = worktrees.filter((worktree) => !worktree.isMainWorktree && !worktree.isBare)
  const found = await Promise.all(
    linked.map((wt) => shared.limit(() => readWorktree(scanFor(wt), wt)))
  )
  return found.filter((item): item is LostWorkItem => item !== null)
}

async function readWorktree(scan: RepoScan, wt: GitWorktreeInfo): Promise<LostWorkItem | null> {
  const { repo, deps, base, signal } = scan
  const checks = scan.settings.checks
  throwIfWorkspaceCleanupScanAborted(signal)
  const branch = shortBranchName(wt.branch)
  // A worktree on the default branch holds no branch work of its own.
  if (branch !== null && branch === base?.branch) {
    return null
  }
  const worktreeId = composeWorktreeId(repo.id, wt.path)
  const kind = await worktreeKind(scan, wt, worktreeId)
  if (kind === 'missing-folder' && !checks.missingFolders) {
    return null
  }
  const tip = wt.head || branch
  const facts = tip ? await readTipFacts(scan, tip, branch) : null
  const dirtyFiles =
    kind === 'missing-folder' ? 0 : await countDirtyFiles(deps.git, wt.path, signal)
  const classification = classifyLostWork({
    kind,
    detached: branch === null,
    dirtyFiles,
    unmergedCommits: facts?.unmerged ?? null,
    unpushedCommits: facts?.unpushed ?? null,
    squashMerged: facts?.squashMerged ?? null,
    pullRequest: facts?.pullRequest,
    commitsPastPullRequest: facts?.commitsPastPullRequest
  })
  if (!wantsWorktree(scan, kind, classification)) {
    return null
  }
  const item: LostWorkItem = {
    id: `${kind}:${worktreeId}`,
    kind,
    risk: classification.risk,
    reasons: classification.reasons,
    repoId: repo.id,
    repoName: repo.name,
    worktreeId,
    path: wt.path,
    branch,
    head: wt.head || undefined,
    ...(base ? { baseRef: base.ref } : {}),
    unmergedCommits: classification.unmergedCommits,
    unpushedCommits: facts?.unpushed ?? null,
    dirtyFiles,
    // The ref read already holds the commit date of every branch head.
    lastCommitAt:
      facts?.committedAt ?? (tip ? await readLastCommitAt(deps.git, scan.cwd, tip, signal) : null),
    ...(facts?.pullRequest ? { pullRequest: facts.pullRequest } : {})
  }
  return item
}
