// SLRM-2096: the lost work scan. Read-only: it lists worktrees, branches and stashes and asks git
// how much of each is merged; nothing is fetched, written or removed. Cancel with the signal.
// SLRM-2175: projects that share one repository are read once, a repository's refs are read in
// one call, pull requests are read beside the git work, and progress is reported as it goes.
import { availableParallelism } from 'node:os'
import type { GitWorktreeInfo } from '../../../shared/worktree/types'
import {
  resolveLostWorkConcurrency,
  type LostWorkItem,
  type LostWorkNote,
  type LostWorkScanProgress,
  type LostWorkScanResult,
  type ResolvedLostWorkSettings
} from '../../../shared/fork/lost-work'
import {
  WorkspaceCleanupScanCancelledError,
  mapWorkspaceCleanupWithConcurrency,
  throwIfWorkspaceCleanupScanAborted
} from '../../ipc/workspace-cleanup/workspace-cleanup-scan-primitives'
import { readBasePatchIds, resolveLostWorkBase, type LostWorkGit } from './lost-work-git'
import {
  groupLostWorkRepos,
  mainProjectOf,
  worktreeProjectOf,
  type LostWorkGroup
} from './lost-work-groups'
import { startLostWorkPullRequests } from './lost-work-pull-request-wait'
import type { LostWorkPullRequestLookup } from './lost-work-pull-requests'
import {
  createLostWorkLimiter,
  readLostWorkRefs,
  scanBranches,
  scanStashes,
  type RepoScan
} from './lost-work-scan-refs'
import { scanWorktrees } from './lost-work-scan-worktrees'

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

export type LostWorkScanOptions = {
  /** Called when a repository starts and when it finishes, with what it found. */
  onProgress?: (progress: LostWorkScanProgress) => void
  /** Cores the automatic concurrency is derived from; the machine's when unset. */
  parallelism?: number
}

type GroupResult = { items: LostWorkItem[]; notes: LostWorkNote[] }

export async function scanLostWork(
  repos: readonly LostWorkRepo[],
  settings: ResolvedLostWorkSettings,
  deps: LostWorkScanDeps,
  signal?: AbortSignal,
  skipped: readonly LostWorkNote[] = [],
  options: LostWorkScanOptions = {}
): Promise<LostWorkScanResult> {
  throwIfWorkspaceCleanupScanAborted(signal)
  const scannedAt = (deps.now ?? Date.now)()
  const concurrency = resolveLostWorkConcurrency(
    settings,
    options.parallelism ?? availableParallelism()
  )
  let groups: LostWorkGroup[]
  try {
    groups = await groupLostWorkRepos(repos, deps.git, concurrency.items, signal)
  } catch (error) {
    throw signal?.aborted ? new WorkspaceCleanupScanCancelledError() : error
  }
  let done = 0
  const current = new Set<string>()
  const report = (finished?: LostWorkScanProgress['finished']) =>
    options.onProgress?.({
      done,
      total: repos.length,
      current: [...current],
      ...(finished ? { finished } : {})
    })
  report()
  const results = await mapWorkspaceCleanupWithConcurrency(
    groups,
    concurrency.projects,
    async (group) => {
      const names = group.members.map((member) => member.repo.name)
      names.forEach((name) => current.add(name))
      report()
      const result = await scanGroup(group, settings, deps, concurrency.items, signal)
      names.forEach((name) => current.delete(name))
      done += group.members.length
      report({ repoIds: group.members.map((member) => member.repo.id), ...result })
      return result
    }
  )
  const items: LostWorkItem[] = []
  const notes: LostWorkNote[] = [...skipped]
  for (const result of results) {
    items.push(...result.items)
    notes.push(...result.notes)
  }
  return { scannedAt, items, notes }
}

/** One repository, however many projects are opened on it. */
async function scanGroup(
  group: LostWorkGroup,
  settings: ResolvedLostWorkSettings,
  deps: LostWorkScanDeps,
  itemConcurrency: number,
  signal?: AbortSignal
): Promise<GroupResult> {
  throwIfWorkspaceCleanupScanAborted(signal)
  const members = group.members.map((member) => member.repo)
  let main = members[0]
  const notes: LostWorkNote[] = []
  const note = (repo: LostWorkRepo, code: LostWorkNote['code'], detail?: string) =>
    notes.push({ repoId: repo.id, repoName: repo.name, code, ...(detail ? { detail } : {}) })
  let pullRequests: ReturnType<typeof startLostWorkPullRequests> | null = null
  try {
    const { checks } = settings
    const worktrees = await deps.listWorktrees(main, signal)
    main = mainProjectOf(group, worktrees)
    for (const repo of members) {
      if (repo !== main) {
        note(repo, 'shared-repository', main.name)
      }
    }
    const pulls = startLostWorkPullRequests(main, settings, deps.lookupPullRequests, signal)
    pullRequests = pulls
    const limit = createLostWorkLimiter(itemConcurrency)
    const heads = worktrees.map((worktree) => worktree.head).filter(Boolean)
    // Projects of one repository usually share a default branch; each override gets its own read.
    const byOverride = new Map<string, Promise<Omit<RepoScan, 'repo'>>>()
    const scanFor = async (repo: LostWorkRepo): Promise<RepoScan> => {
      const override = settings.defaultBranches[repo.id]
      let shared = byOverride.get(override ?? '')
      if (!shared) {
        shared = (async () => {
          const base = await resolveLostWorkBase(deps.git, main.path, override, signal)
          let patchIds: Promise<Set<string>> | null = null
          let refs: ReturnType<typeof readLostWorkRefs> | null = null
          return {
            cwd: main.path,
            settings,
            deps,
            base,
            pullRequests: pulls.get,
            basePatchIds: () => {
              patchIds ??= base
                ? readBasePatchIds(deps.git, main.path, base.ref, settings.squashLookback, signal)
                : Promise.resolve(new Set())
              return patchIds
            },
            refs: () => (refs ??= readLostWorkRefs(deps.git, main.path, base, heads, signal)),
            limit,
            signal
          }
        })()
        byOverride.set(override ?? '', shared)
      }
      return { ...(await shared), repo }
    }
    const scans = new Map<string, RepoScan>()
    for (const repo of members) {
      const scan = await scanFor(repo)
      scans.set(repo.id, scan)
      if (!scan.base) {
        note(repo, 'no-default-branch', settings.defaultBranches[repo.id])
      }
    }
    const mainScan = scans.get(main.id) as RepoScan
    const found = await Promise.all([
      scanWorktrees(mainScan, worktrees, (worktree) => {
        const owner = worktreeProjectOf(group, main, worktree, deps.isTracked)
        return scans.get(owner.id) ?? mainScan
      }),
      checks.unmergedBranches ? scanBranches(mainScan, worktrees) : [],
      checks.stashes ? scanStashes(mainScan) : []
    ])
    if (pulls.wanted && (await pulls.get()) === null) {
      throwIfWorkspaceCleanupScanAborted(signal)
      note(main, 'pull-requests-unavailable')
    }
    return { items: found.flat(), notes }
  } catch (error) {
    if (error instanceof WorkspaceCleanupScanCancelledError || signal?.aborted) {
      throw new WorkspaceCleanupScanCancelledError()
    }
    note(main, 'git-error', error instanceof Error ? error.message.slice(0, 300) : String(error))
    return { items: [], notes }
  } finally {
    pullRequests?.stop()
  }
}
