// SLRM-2096: the lost work scan. Read-only: it lists worktrees, branches and stashes and asks git
// how much of each is merged; nothing is fetched, written or removed. Cancel with the signal.
import type { GitWorktreeInfo } from '../../../shared/worktree/types'
import { composeWorktreeId } from '../../../shared/worktree/id'
import type {
  LostWorkItem,
  LostWorkKind,
  LostWorkNote,
  LostWorkScanResult,
  ResolvedLostWorkSettings
} from '../../../shared/fork/lost-work'
import {
  WorkspaceCleanupScanCancelledError,
  mapWorkspaceCleanupWithConcurrency,
  throwIfWorkspaceCleanupScanAborted
} from '../../ipc/workspace-cleanup/workspace-cleanup-scan-primitives'
import { classifyLostWork, type LostWorkClassification } from './lost-work-classify'
import {
  countDirtyFiles,
  readBasePatchIds,
  readLastCommitAt,
  resolveLostWorkBase,
  shortBranchName,
  type LostWorkGit
} from './lost-work-git'
import type { LostWorkPullRequestLookup, LostWorkPullRequestMap } from './lost-work-pull-requests'
import {
  ITEM_CONCURRENCY,
  readTipFacts,
  scanBranches,
  scanStashes,
  type RepoScan
} from './lost-work-scan-refs'

export type LostWorkRepo = {
  id: string
  name: string
  path: string
  ghAccount?: { host: string; user: string }
}

export type LostWorkScanDeps = {
  git: LostWorkGit
  listWorktrees: (repo: LostWorkRepo, signal?: AbortSignal) => Promise<GitWorktreeInfo[]>
  /** True when Orca keeps state for this `repoId::path` worktree. */
  isTracked: (worktreeId: string) => boolean
  pathExists: (path: string) => Promise<boolean>
  lookupPullRequests?: LostWorkPullRequestLookup
  now?: () => number
}

const REPO_CONCURRENCY = 2

export async function scanLostWork(
  repos: readonly LostWorkRepo[],
  settings: ResolvedLostWorkSettings,
  deps: LostWorkScanDeps,
  signal?: AbortSignal,
  skipped: readonly LostWorkNote[] = []
): Promise<LostWorkScanResult> {
  throwIfWorkspaceCleanupScanAborted(signal)
  const scannedAt = (deps.now ?? Date.now)()
  const items: LostWorkItem[] = []
  const notes: LostWorkNote[] = [...skipped]
  const results = await mapWorkspaceCleanupWithConcurrency(repos, REPO_CONCURRENCY, (repo) =>
    scanRepo(repo, settings, deps, signal)
  )
  for (const result of results) {
    items.push(...result.items)
    notes.push(...result.notes)
  }
  return { scannedAt, items, notes }
}

async function scanRepo(
  repo: LostWorkRepo,
  settings: ResolvedLostWorkSettings,
  deps: LostWorkScanDeps,
  signal?: AbortSignal
): Promise<{ items: LostWorkItem[]; notes: LostWorkNote[] }> {
  throwIfWorkspaceCleanupScanAborted(signal)
  const notes: LostWorkNote[] = []
  const note = (code: LostWorkNote['code'], detail?: string) =>
    notes.push({ repoId: repo.id, repoName: repo.name, code, ...(detail ? { detail } : {}) })
  try {
    const { checks } = settings
    const base = await resolveLostWorkBase(
      deps.git,
      repo.path,
      settings.defaultBranches[repo.id],
      signal
    )
    if (!base) {
      note('no-default-branch', settings.defaultBranches[repo.id])
    }
    let pullRequests: LostWorkPullRequestMap | null = null
    if (checks.pullRequests && deps.lookupPullRequests) {
      pullRequests = await deps.lookupPullRequests(repo, settings.pullRequestLimit, signal)
      if (!pullRequests) {
        note('pull-requests-unavailable')
      }
    }
    let patchIdsPromise: Promise<Set<string>> | null = null
    const scan: RepoScan = {
      repo,
      settings,
      deps,
      base,
      pullRequests,
      basePatchIds: () => {
        patchIdsPromise ??= base
          ? readBasePatchIds(deps.git, repo.path, base.ref, settings.squashLookback, signal)
          : Promise.resolve(new Set())
        return patchIdsPromise
      },
      signal
    }
    const worktrees = await deps.listWorktrees(repo, signal)
    const items: LostWorkItem[] = [
      ...(await scanWorktrees(scan, worktrees)),
      ...(checks.unmergedBranches ? await scanBranches(scan, worktrees) : []),
      ...(checks.stashes ? await scanStashes(scan) : [])
    ]
    return { items, notes }
  } catch (error) {
    if (error instanceof WorkspaceCleanupScanCancelledError || signal?.aborted) {
      throw new WorkspaceCleanupScanCancelledError()
    }
    note('git-error', error instanceof Error ? error.message.slice(0, 300) : String(error))
    return { items: [], notes }
  }
}

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

async function scanWorktrees(
  scan: RepoScan,
  worktrees: readonly GitWorktreeInfo[]
): Promise<LostWorkItem[]> {
  const { repo, deps, base, signal } = scan
  const checks = scan.settings.checks
  if (
    !checks.unmergedWorktrees &&
    !checks.finishedWorktrees &&
    !checks.untrackedWorktrees &&
    !checks.missingFolders
  ) {
    return []
  }
  const linked = worktrees.filter((worktree) => !worktree.isMainWorktree && !worktree.isBare)
  const found = await mapWorkspaceCleanupWithConcurrency(linked, ITEM_CONCURRENCY, async (wt) => {
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
      lastCommitAt: tip ? await readLastCommitAt(deps.git, repo.path, tip, signal) : null,
      ...(facts?.pullRequest ? { pullRequest: facts.pullRequest } : {})
    }
    return item
  })
  return found.filter((item): item is LostWorkItem => item !== null)
}
