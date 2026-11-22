// BAD-691 (FORK.md "Worktree reclaim"): `orca workspace reclaim` and the Space action. Walks this
// host's local git projects, skips workspaces that are in use, not idle, untracked or the main
// checkout, and plans or deletes the regenerable git-ignored paths of the rest. Nothing here is
// scheduled: a person starts every run, so Pause all (BAD-685) has nothing to gate.
import { access } from 'node:fs/promises'
import type { RuntimeStore } from '../../runtime/construction/runtime-store-contract'
import { gitExecFileAsync } from '../../git/command-runner/git-exec-file'
import { listCleanupGitWorktrees } from '../../ipc/workspace-cleanup/workspace-cleanup-worktree-listing'
import { loadHooks } from '../../workspace-hooks/hooks'
import { isFolderRepo } from '../../../shared/repository/repo-kind'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID
} from '../../../shared/execution-host/execution-host'
import { composeWorktreeId } from '../../../shared/worktree/id'
import type { Repo } from '../../../shared/repository/repo-types'
import {
  readForkWorktreeReclaimSettings,
  type ForkWorktreeReclaimResult,
  type ForkWorktreeReclaimRunParamsShape,
  type ForkWorktreeReclaimWorktree
} from '../../../shared/fork/worktree-reclaim'
import { normalizeReclaimGlobs } from '../../../shared/fork/worktree-reclaim-glob'
import {
  applyWorktreeReclaim,
  planWorktreeReclaim,
  type ReclaimGit
} from './worktree-reclaim-files'

const DAY_MS = 86_400_000
const GIT_TIMEOUT_MS = 2 * 60_000

const git: ReclaimGit = async (args, options) =>
  (
    await gitExecFileAsync(args, {
      cwd: options.cwd,
      signal: options.signal,
      timeout: GIT_TIMEOUT_MS
    })
  ).stdout

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function isLocalGitRepo(repo: Repo): boolean {
  return !isFolderRepo(repo) && getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID
}

function repoName(repo: Repo): string {
  return repo.displayName || repo.path
}

/** A project's own list (orca.yaml worktree.reclaim) replaces the setting's list. */
function globsFor(repo: Repo, settingPaths: string[]): string[] {
  const own = normalizeReclaimGlobs(loadHooks(repo.path)?.worktree?.reclaim)
  return own.length > 0 ? own : settingPaths
}

export type ForkWorktreeReclaimOptions = {
  store: RuntimeStore
  params: ForkWorktreeReclaimRunParamsShape
  /** True when something holds the workspace open: a running agent, a live terminal, a chat. */
  inUse: (worktreeId: string) => boolean
  signal?: AbortSignal
  now?: number
}

export async function runForkWorktreeReclaim(
  options: ForkWorktreeReclaimOptions
): Promise<ForkWorktreeReclaimResult> {
  const { store, params, signal } = options
  const config = readForkWorktreeReclaimSettings(store.getSettings())
  const apply = params.apply === true
  if (apply && !config.enabled) {
    throw new Error(
      'Worktree reclaim is off. Turn it on with `orca settings set forkWorktreeReclaim true`, or run with --dry-run to see what it would remove.'
    )
  }
  const idleDays = params.idleDays ?? config.idleDays
  const cutoff = (options.now ?? Date.now()) - idleDays * DAY_MS
  const notes: string[] = []
  const worktrees: ForkWorktreeReclaimWorktree[] = []
  const wanted = params.repo
  const repos = store
    .getRepos()
    .filter((repo) => !wanted || repo.id === wanted || repo.displayName === wanted)
  for (const repo of repos) {
    if (isFolderRepo(repo) || !isLocalGitRepo(repo)) {
      notes.push(
        `${repoName(repo)}: skipped, ${isFolderRepo(repo) ? 'not a git project' : 'runs on another host'}`
      )
      continue
    }
    try {
      const { gitWorktrees } = await listCleanupGitWorktrees(store, repo, false, signal)
      const globs = globsFor(repo, config.paths)
      for (const wt of gitWorktrees) {
        const worktreeId = composeWorktreeId(repo.id, wt.path)
        if (params.workspace && params.workspace !== worktreeId && params.workspace !== wt.path) {
          continue
        }
        const row: ForkWorktreeReclaimWorktree = {
          repoId: repo.id,
          repoName: repoName(repo),
          worktreeId,
          path: wt.path,
          branch: wt.branch ? wt.branch.replace(/^refs\/heads\//, '') : null,
          lastActivityAt: store.getWorktreeMeta(worktreeId)?.lastActivityAt ?? null,
          entries: [],
          bytes: 0
        }
        const skipReason = await skipReasonFor(row, wt, cutoff, options.inUse)
        if (skipReason) {
          worktrees.push({ ...row, skipReason })
          continue
        }
        try {
          const planned = await planWorktreeReclaim({ git, root: wt.path, globs, signal })
          row.entries = apply ? await applyWorktreeReclaim(wt.path, planned, signal) : planned
          row.bytes = row.entries.reduce((sum, entry) => sum + (entry.skipped ? 0 : entry.bytes), 0)
          worktrees.push(row)
        } catch (error) {
          if (signal?.aborted) {
            throw error
          }
          worktrees.push({ ...row, skipReason: 'git-error' })
        }
      }
    } catch (error) {
      if (signal?.aborted) {
        throw error
      }
      notes.push(`${repoName(repo)}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return {
    enabled: config.enabled,
    dryRun: !apply,
    idleDays,
    worktrees,
    totalBytes: worktrees.reduce((sum, row) => sum + row.bytes, 0),
    notes
  }
}

async function skipReasonFor(
  row: ForkWorktreeReclaimWorktree,
  wt: { isMainWorktree: boolean; isBare: boolean; prunable?: boolean },
  cutoff: number,
  inUse: (worktreeId: string) => boolean
): Promise<ForkWorktreeReclaimWorktree['skipReason'] | null> {
  if (wt.isMainWorktree || wt.isBare) {
    return 'main-checkout'
  }
  if (wt.prunable || !(await exists(row.path))) {
    return 'missing-folder'
  }
  // No activity record means Orca never tracked it, so idleness cannot be shown.
  if (row.lastActivityAt === null) {
    return 'not-tracked'
  }
  if (inUse(row.worktreeId)) {
    return 'in-use'
  }
  return row.lastActivityAt > cutoff ? 'not-idle' : null
}
