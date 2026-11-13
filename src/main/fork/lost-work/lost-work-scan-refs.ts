// SLRM-2096: the lost work scan's per-commit facts, and its branch and stash passes. Read-only.
import type { LostWorkItem, ResolvedLostWorkSettings } from '../../../shared/fork/lost-work'
import type { GitWorktreeInfo } from '../../../shared/worktree/types'
import {
  mapWorkspaceCleanupWithConcurrency,
  throwIfWorkspaceCleanupScanAborted
} from '../../ipc/workspace-cleanup/workspace-cleanup-scan-primitives'
import { classifyLostWork } from './lost-work-classify'
import {
  countCommitsPast,
  countUnmergedCommits,
  countUnpushedCommits,
  isSquashMerged,
  listLocalBranches,
  listStashes,
  shortBranchName,
  type LostWorkBase
} from './lost-work-git'
import type { LostWorkPullRequestMap } from './lost-work-pull-requests'
import type { LostWorkRepo, LostWorkScanDeps } from './lost-work-scan'

export const ITEM_CONCURRENCY = 3

export type RepoScan = {
  repo: LostWorkRepo
  settings: ResolvedLostWorkSettings
  deps: LostWorkScanDeps
  base: LostWorkBase | null
  pullRequests: LostWorkPullRequestMap | null
  basePatchIds: () => Promise<Set<string>>
  signal?: AbortSignal
}

export async function readTipFacts(scan: RepoScan, tip: string, branch: string | null) {
  const { deps, repo, base, signal } = scan
  const baseRef = base?.ref ?? null
  const unmerged = baseRef
    ? await countUnmergedCommits(deps.git, repo.path, baseRef, tip, signal)
    : null
  const unpushed = await countUnpushedCommits(deps.git, repo.path, baseRef, tip, signal)
  const squashMerged =
    baseRef && unmerged !== null && unmerged > 0
      ? await isSquashMerged(deps.git, repo.path, baseRef, tip, scan.basePatchIds, signal)
      : null
  const found = branch ? scan.pullRequests?.get(branch) : undefined
  const pullRequest = found
    ? { number: found.number, state: found.state, url: found.url }
    : undefined
  const commitsPastPullRequest =
    found?.state === 'merged'
      ? await countCommitsPast(deps.git, repo.path, baseRef, found.headOid, tip, signal)
      : undefined
  return { unmerged, unpushed, squashMerged, pullRequest, commitsPastPullRequest }
}

export async function scanBranches(
  scan: RepoScan,
  worktrees: readonly GitWorktreeInfo[]
): Promise<LostWorkItem[]> {
  const { repo, deps, base, signal } = scan
  if (!base) {
    // Without a base every branch would read as unmerged; the note says why none are listed.
    return []
  }
  const checkedOut = new Set(
    worktrees.map((worktree) => shortBranchName(worktree.branch)).filter(Boolean)
  )
  const branches = (await listLocalBranches(deps.git, repo.path, signal)).filter(
    (branch) => branch.name !== base.branch && !checkedOut.has(branch.name)
  )
  const found = await mapWorkspaceCleanupWithConcurrency(branches, ITEM_CONCURRENCY, async (b) => {
    throwIfWorkspaceCleanupScanAborted(signal)
    const facts = await readTipFacts(scan, b.head, b.name)
    const classification = classifyLostWork({
      kind: 'branch',
      dirtyFiles: null,
      unmergedCommits: facts.unmerged,
      unpushedCommits: facts.unpushed,
      squashMerged: facts.squashMerged,
      pullRequest: facts.pullRequest,
      commitsPastPullRequest: facts.commitsPastPullRequest
    })
    if (classification.unmergedCommits === null || classification.unmergedCommits === 0) {
      return null
    }
    const item: LostWorkItem = {
      id: `branch:${repo.id}:${b.name}`,
      kind: 'branch',
      risk: classification.risk,
      reasons: classification.reasons,
      repoId: repo.id,
      repoName: repo.name,
      branch: b.name,
      head: b.head,
      baseRef: base.ref,
      unmergedCommits: classification.unmergedCommits,
      unpushedCommits: facts.unpushed,
      dirtyFiles: null,
      lastCommitAt: b.committedAt,
      ...(facts.pullRequest ? { pullRequest: facts.pullRequest } : {})
    }
    return item
  })
  return found.filter((item): item is LostWorkItem => item !== null)
}

export async function scanStashes(scan: RepoScan): Promise<LostWorkItem[]> {
  const { repo, deps, signal } = scan
  const stashes = await listStashes(deps.git, repo.path, signal)
  return stashes.map((stash) => {
    const classification = classifyLostWork({
      kind: 'stash',
      dirtyFiles: null,
      unmergedCommits: null,
      unpushedCommits: null,
      squashMerged: null
    })
    return {
      id: `stash:${repo.id}:${stash.head}`,
      kind: 'stash' as const,
      risk: classification.risk,
      reasons: classification.reasons,
      repoId: repo.id,
      repoName: repo.name,
      head: stash.head,
      unmergedCommits: null,
      unpushedCommits: null,
      dirtyFiles: null,
      lastCommitAt: stash.createdAt,
      stash: { index: stash.index, message: stash.message.slice(0, 300) }
    }
  })
}
