// SLRM-2096 (FORK.md "Lost work"): the lost work scan and actions wired to this process's projects,
// git and gh. No Electron here, so the `fork.lostWork.scan` RPC can import it on any host; the
// desktop's IPC host sets the store when it installs.
import { access } from 'node:fs/promises'
import type { Store } from '../../persistence/loading-store/store'
import { gitExecFileAsync } from '../../git/command-runner/git-exec-file'
import { ghExecFileAsync } from '../../git/command-runner/hosted-cli/gh-exec-file'
import { listCleanupGitWorktrees } from '../../ipc/workspace-cleanup/workspace-cleanup-worktree-listing'
import { isFolderRepo } from '../../../shared/repo-kind'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import type { Repo } from '../../../shared/repo-types'
import {
  resolveLostWorkSettings,
  type LostWorkActionArgs,
  type LostWorkActionResult,
  type LostWorkNote,
  type LostWorkScanResult
} from '../../../shared/fork/lost-work'
import { scanLostWork, type LostWorkRepo, type LostWorkScanDeps } from './lost-work-scan'
import { runLostWorkAction, type LostWorkActionDeps } from './lost-work-actions'
import { lostWorkPullRequestArgs, parseLostWorkPullRequests } from './lost-work-pull-requests'
import type { LostWorkGit } from './lost-work-git'

let installedStore: Store | null = null

export function setForkLostWorkStore(store: Store): void {
  installedStore = store
}

export function forkLostWorkStore(): Store | null {
  return installedStore
}

/** existsSync without blocking main: true when the path resolves, false on any error. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const git: LostWorkGit = async (args, options) =>
  (await gitExecFileAsync(args, { cwd: options.cwd, signal: options.signal, stdin: options.stdin }))
    .stdout

function toLostWorkRepo(repo: Repo): LostWorkRepo {
  return {
    id: repo.id,
    name: repo.displayName || repo.path,
    path: repo.path,
    ...(repo.ghAccount ? { ghAccount: repo.ghAccount } : {})
  }
}

function isLocalGitRepo(repo: Repo): boolean {
  return !isFolderRepo(repo) && getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID
}

function deps(store: Store): LostWorkScanDeps & LostWorkActionDeps {
  const findStoreRepo = (repoId: string) => store.getRepos().find((repo) => repo.id === repoId)
  return {
    git,
    listWorktrees: async (lostWorkRepo, signal) => {
      const repo = findStoreRepo(lostWorkRepo.id)
      return repo ? (await listCleanupGitWorktrees(store, repo, false, signal)).gitWorktrees : []
    },
    isTracked: (worktreeId) => store.getWorktreeMeta(worktreeId) !== undefined,
    pathExists,
    lookupPullRequests: async (repo, limit, signal) => {
      try {
        const { stdout } = await ghExecFileAsync(lostWorkPullRequestArgs(limit), {
          cwd: repo.path,
          signal,
          ...(repo.ghAccount ? { ghAccount: repo.ghAccount } : {})
        })
        return parseLostWorkPullRequests(stdout)
      } catch (error) {
        if (signal?.aborted) {
          throw error
        }
        // No gh, no login, or not a GitHub remote: the scan goes on without pull requests.
        return null
      }
    },
    findRepo: (repoId) => {
      const repo = findStoreRepo(repoId)
      return repo && isLocalGitRepo(repo) ? toLostWorkRepo(repo) : null
    }
  }
}

/** Scans this process's local git projects, or those `repoFilter` keeps. */
export async function runForkLostWorkScan(
  store: Store,
  signal?: AbortSignal,
  repoFilter?: (repo: Repo) => boolean
): Promise<LostWorkScanResult> {
  const settings = resolveLostWorkSettings(store.getSettings().forkLostWork)
  const repos = store.getRepos().filter((repo) => !repoFilter || repoFilter(repo))
  const skipped: LostWorkNote[] = repos
    .filter((repo) => !isLocalGitRepo(repo))
    .map((repo) => ({
      repoId: repo.id,
      repoName: repo.displayName || repo.path,
      code: isFolderRepo(repo) ? 'folder-project' : 'remote-project'
    }))
  const local = repos.filter(isLocalGitRepo).map(toLostWorkRepo)
  return scanLostWork(local, settings, deps(store), signal, skipped)
}

export function runForkLostWorkAction(
  store: Store,
  args: LostWorkActionArgs
): Promise<LostWorkActionResult> {
  return runLostWorkAction(deps(store), args)
}
