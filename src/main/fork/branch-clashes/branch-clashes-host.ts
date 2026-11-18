// Branch clashes (FORK.md, SLRM-2394): this host's own report, over its local git projects. The
// desktop and every paired server answer `fork.clashes.local` with it. No Electron here: orcad runs
// it too.
import type { RuntimeStore } from '../../runtime/construction/runtime-store-contract'
import { gitExecFileAsync } from '../../git/command-runner/git-exec-file'
import { listCleanupGitWorktrees } from '../../ipc/workspace-cleanup/workspace-cleanup-worktree-listing'
import { mapWithConcurrency } from '../../../shared/concurrency/map-with-concurrency'
import { isFolderRepo } from '../../../shared/repository/repo-kind'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID
} from '../../../shared/execution-host/execution-host'
import {
  forkClashRepoMatches,
  readForkBranchClashConfig,
  type ForkClashHostReport
} from '../../../shared/fork/branch-clashes'
import { resolveLostWorkSettings, type LostWorkSettings } from '../../../shared/fork/lost-work'
import type { LostWorkGit } from '../lost-work/lost-work-git'
import {
  ForkClashCache,
  scanClashRepo,
  type ClashRepo,
  type ClashScanDeps
} from './branch-clashes-git'

const REPO_CONCURRENCY = 2

const git: LostWorkGit = async (args, options) =>
  (await gitExecFileAsync(args, { cwd: options.cwd, signal: options.signal })).stdout

const cache = new ForkClashCache()
/** Scans running now, by project; a caller asking for the same one joins it. */
const inFlight = new Map<string, Promise<ForkClashHostReport>>()

function storeDeps(store: RuntimeStore): ClashScanDeps {
  return {
    git,
    listWorktrees: async (clashRepo, signal) => {
      const repo = store.getRepos().find((entry) => entry.id === clashRepo.id)
      return repo ? (await listCleanupGitWorktrees(store, repo, false, signal)).gitWorktrees : []
    }
  }
}

/**
 * This host's report, shared with any caller already waiting for the same project. A shared scan
 * takes no caller's abort signal, so one caller hanging up never fails the others; it is bounded.
 */
export function scanForkClashesHere(
  store: RuntimeStore,
  project: string | undefined
): Promise<ForkClashHostReport> {
  const key = project ?? ''
  const running = inFlight.get(key)
  if (running) {
    return running
  }
  const next = scanForkClashesNow(store, project).finally(() => inFlight.delete(key))
  inFlight.set(key, next)
  return next
}

/** This host's report; `off` when this host has the warning switched off. */
export async function scanForkClashesNow(
  store: RuntimeStore,
  project: string | undefined,
  signal?: AbortSignal,
  deps: ClashScanDeps = storeDeps(store)
): Promise<ForkClashHostReport> {
  const settings: unknown = store.getSettings()
  const config = readForkBranchClashConfig(settings)
  if (!config.enabled) {
    return { off: true, repos: [] }
  }
  const lostWork = (settings as { forkLostWork?: LostWorkSettings } | null)?.forkLostWork
  const defaults = resolveLostWorkSettings(lostWork).defaultBranches
  const repos: ClashRepo[] = store
    .getRepos()
    .filter(
      (repo) => !isFolderRepo(repo) && getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID
    )
    .map((repo) => ({
      id: repo.id,
      name: repo.displayName || repo.path,
      path: repo.path,
      ...(defaults[repo.id] ? { defaultBranch: defaults[repo.id] } : {})
    }))
  // A project named by display name or id reads only those repos; a remote key needs every remote.
  const named = project
    ? repos.filter((repo) =>
        forkClashRepoMatches({ repoId: repo.id, name: repo.name, projectKey: null }, project)
      )
    : []
  const scanned = await mapWithConcurrency(
    named.length > 0 ? named : repos,
    REPO_CONCURRENCY,
    (repo) => scanClashRepo(deps, repo, cache, { uncommitted: config.uncommitted, signal })
  )
  return {
    repos: project ? scanned.filter((repo) => forkClashRepoMatches(repo, project)) : scanned
  }
}
