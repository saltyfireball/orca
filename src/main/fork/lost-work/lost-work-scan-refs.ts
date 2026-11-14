// SLRM-2096: the lost work scan's per-commit facts, and its branch and stash passes. Read-only.
// SLRM-2175: facts come from one read of the repository's refs where that gives the same answer.
import type { LostWorkItem, ResolvedLostWorkSettings } from '../../../shared/fork/lost-work'
import type { GitWorktreeInfo } from '../../../shared/worktree/types'
import { throwIfWorkspaceCleanupScanAborted } from '../../ipc/workspace-cleanup/workspace-cleanup-scan-primitives'
import { classifyLostWork } from './lost-work-classify'
import {
  countUnpushedInGraph,
  readBranchFacts,
  readUnpushedGraph,
  type LostWorkBranchFacts,
  type LostWorkUnpushedGraph
} from './lost-work-batch'
import {
  LOST_WORK_OID,
  countCommitsPast,
  countUnmergedCommits,
  countUnpushedCommits,
  isSquashMerged,
  listStashes,
  shortBranchName,
  type LostWorkBase,
  type LostWorkGit
} from './lost-work-git'
import type { LostWorkPullRequestMap } from './lost-work-pull-requests'
import type { LostWorkRepo, LostWorkScanDeps } from './lost-work-scan'

/** Runs at most `limit` tasks at once; a repository's worktrees and branches share one. */
export type LostWorkLimiter = <T>(task: () => Promise<T>) => Promise<T>

export function createLostWorkLimiter(limit: number): LostWorkLimiter {
  let active = 0
  const waiting: (() => void)[] = []
  return async (task) => {
    if (active >= Math.max(1, limit)) {
      await new Promise<void>((resolve) => waiting.push(resolve))
    } else {
      active += 1
    }
    try {
      return await task()
    } finally {
      const next = waiting.shift()
      if (next) {
        // The slot passes straight to the next task.
        next()
      } else {
        active -= 1
      }
    }
  }
}

/** What one read of a repository's refs gives every branch and worktree (SLRM-2175). */
export type LostWorkRefs = {
  facts: LostWorkBranchFacts
  unpushed: LostWorkUnpushedGraph | null
  /** The commits `unpushed` was asked about; any other tip is counted on its own. */
  covered: ReadonlySet<string>
}

export async function readLostWorkRefs(
  git: LostWorkGit,
  cwd: string,
  base: LostWorkBase | null,
  worktreeHeads: readonly string[],
  signal?: AbortSignal
): Promise<LostWorkRefs> {
  const facts = await readBranchFacts(git, cwd, base?.oid, signal)
  const extraTips = [...new Set(worktreeHeads)].filter(
    (head) => LOST_WORK_OID.test(head) && !facts.byHead.has(head)
  )
  const unpushed = await readUnpushedGraph(git, cwd, base?.ref ?? null, extraTips, signal)
  return { facts, unpushed, covered: new Set([...facts.byHead.keys(), ...extraTips]) }
}

export type RepoScan = {
  /** The project items are listed under. */
  repo: LostWorkRepo
  /** Where git reads the repository's refs; projects of one repository share it. */
  cwd: string
  settings: ResolvedLostWorkSettings
  deps: LostWorkScanDeps
  base: LostWorkBase | null
  /** Resolves when the pull request read ends; null when it failed or ran out of time. */
  pullRequests: () => Promise<LostWorkPullRequestMap | null>
  basePatchIds: () => Promise<Set<string>>
  refs: () => Promise<LostWorkRefs>
  limit: LostWorkLimiter
  signal?: AbortSignal
}

export async function readTipFacts(scan: RepoScan, tip: string, branch: string | null) {
  const { deps, cwd, base, signal } = scan
  const baseRef = base?.ref ?? null
  const refs = await scan.refs()
  const fact = refs.facts.byHead.get(tip)
  // Nothing ahead of the base: every count below is zero, so no per-branch git runs.
  const onBase = baseRef !== null && fact?.ahead === 0
  let unmerged: number | null = null
  if (baseRef) {
    unmerged = onBase ? 0 : await countUnmergedCommits(deps.git, cwd, baseRef, tip, signal)
  }
  let unpushed: number | null = 0
  if (!onBase && !fact?.upstreamInSync) {
    unpushed =
      refs.unpushed && refs.covered.has(tip)
        ? countUnpushedInGraph(refs.unpushed, tip)
        : await countUnpushedCommits(deps.git, cwd, baseRef, tip, signal)
  }
  const squashMerged =
    baseRef && unmerged !== null && unmerged > 0
      ? await isSquashMerged(deps.git, cwd, baseRef, tip, scan.basePatchIds, signal)
      : null
  // The pull request read runs beside the git work; it is only waited for here.
  const found = branch ? (await scan.pullRequests())?.get(branch) : undefined
  throwIfWorkspaceCleanupScanAborted(signal)
  const pullRequest = found
    ? { number: found.number, state: found.state, url: found.url }
    : undefined
  let commitsPastPullRequest: number | null | undefined
  if (found?.state === 'merged') {
    commitsPastPullRequest = onBase
      ? 0
      : await countCommitsPast(deps.git, cwd, baseRef, found.headOid, tip, signal)
  }
  return {
    unmerged,
    unpushed,
    squashMerged,
    pullRequest,
    commitsPastPullRequest,
    committedAt: fact?.committedAt ?? null
  }
}

export async function scanBranches(
  scan: RepoScan,
  worktrees: readonly GitWorktreeInfo[]
): Promise<LostWorkItem[]> {
  const { repo, base, signal } = scan
  if (!base) {
    // Without a base every branch would read as unmerged; the note says why none are listed.
    return []
  }
  const checkedOut = new Set(
    worktrees.map((worktree) => shortBranchName(worktree.branch)).filter(Boolean)
  )
  // A branch with nothing ahead of the base is never listed, whatever its pull request says.
  const branches = (await scan.refs()).facts.branches.filter(
    (branch) => branch.name !== base.branch && !checkedOut.has(branch.name) && branch.ahead !== 0
  )
  const found = await Promise.all(
    branches.map((b) =>
      scan.limit(async () => {
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
    )
  )
  return found.filter((item): item is LostWorkItem => item !== null)
}

export async function scanStashes(scan: RepoScan): Promise<LostWorkItem[]> {
  const { repo, deps, signal } = scan
  const stashes = await listStashes(deps.git, scan.cwd, signal)
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
