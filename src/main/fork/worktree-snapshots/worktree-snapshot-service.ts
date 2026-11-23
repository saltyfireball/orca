// BAD-677 (FORK.md "Worktree snapshots"): the hook the shared removal path calls, and the host side
// of `orca worktree snapshots|restore`. Every host that removes worktrees (the desktop app, `orca
// serve`, orcad) installs its own settings reader; a process that never does snapshots nothing.
import { access } from 'node:fs/promises'
import { gitExecFileAsync } from '../../git/command-runner/git-exec-file'
import { isFolderRepo } from '../../../shared/repository/repo-kind'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID
} from '../../../shared/execution-host/execution-host'
import type { Repo } from '../../../shared/repository/repo-types'
import {
  readForkWorktreeSnapshotSettings,
  type ForkWorktreeSnapshot,
  type ForkWorktreeSnapshotConfig,
  type ForkWorktreeSnapshotsListResult,
  type ForkWorktreeSnapshotsPruneResult,
  type ForkWorktreeSnapshotsRestoreResult
} from '../../../shared/fork/worktree-snapshots'
import {
  createWorktreeSnapshot,
  listWorktreeSnapshots,
  pruneWorktreeSnapshots,
  restoreWorktreeSnapshot,
  type SnapshotGit
} from './worktree-snapshot-git'

let readSettings: (() => unknown) | null = null

const GIT_TIMEOUT_MS = 5 * 60_000

/** Points the feature at this host's settings. Reads nothing yet. */
export function installForkWorktreeSnapshots(store: { getSettings: () => unknown }): void {
  readSettings = () => store.getSettings()
}

function config(): ForkWorktreeSnapshotConfig {
  return readSettings
    ? readForkWorktreeSnapshotSettings(readSettings())
    : { ...readForkWorktreeSnapshotSettings(null), enabled: false }
}

function appGit(wslDistro?: string): SnapshotGit {
  return async (args, options) =>
    (
      await gitExecFileAsync(args, {
        cwd: options.cwd,
        timeout: GIT_TIMEOUT_MS,
        ...(options.stdin !== undefined ? { stdin: options.stdin } : {}),
        ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
        ...(wslDistro ? { wslDistro } : {})
      })
    ).stdout
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Called by the shared removal path before Git deletes a worktree. Writes a snapshot when the
 * worktree holds work. A snapshot that cannot be written stops the removal, unless `force`.
 */
export async function forkSnapshotBeforeWorktreeRemoval(
  repoPath: string,
  worktreePath: string,
  force: boolean,
  options: { wslDistro?: string; forceBranchDelete?: boolean; noForceHint?: boolean } = {}
): Promise<void> {
  const current = config()
  // A failed-creation rollback removes a worktree nobody has worked in.
  if (!current.enabled || options.forceBranchDelete || !(await exists(worktreePath))) {
    return
  }
  const git = appGit(options.wslDistro)
  try {
    await createWorktreeSnapshot(git, worktreePath, Date.now())
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (force) {
      console.warn(
        `[fork-worktree-snapshots] Removing ${worktreePath} without a snapshot: ${reason}`
      )
      return
    }
    // BAD-767: Lost work cannot force a delete, so its message names what the person can do.
    const advice = options.noForceHint
      ? 'Free some disk space and try again, or remove the worktree with git by hand (git worktree remove --force).'
      : 'Force the delete to remove it without a snapshot.'
    throw new Error(
      `Could not snapshot ${worktreePath} before removing it, so nothing was removed: ${reason}. ${advice}`
    )
  }
  await pruneWorktreeSnapshots(
    git,
    { id: '', name: '', path: repoPath },
    current.retentionDays,
    Date.now()
  ).catch(() => undefined)
}

type SnapshotRepo = { id: string; name: string; path: string }

function localGitRepos(repos: Repo[], wanted?: string): SnapshotRepo[] {
  return repos
    .filter(
      (repo) =>
        !isFolderRepo(repo) &&
        getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID &&
        (!wanted || repo.id === wanted || repo.displayName === wanted || repo.path === wanted)
    )
    .map((repo) => ({ id: repo.id, name: repo.displayName || repo.path, path: repo.path }))
}

type RepoStore = { getRepos: () => Repo[] }

export async function listForkWorktreeSnapshots(
  store: RepoStore,
  wanted?: string
): Promise<ForkWorktreeSnapshotsListResult> {
  const current = config()
  const git = appGit()
  const snapshots: ForkWorktreeSnapshot[] = []
  const notes: string[] = []
  for (const repo of localGitRepos(store.getRepos(), wanted)) {
    try {
      snapshots.push(...(await listWorktreeSnapshots(git, repo, current.retentionDays)))
    } catch (error) {
      notes.push(`${repo.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  snapshots.sort((a, b) => b.createdAt - a.createdAt)
  return { enabled: current.enabled, retentionDays: current.retentionDays, snapshots, notes }
}

export async function pruneForkWorktreeSnapshots(
  store: RepoStore,
  wanted?: string
): Promise<ForkWorktreeSnapshotsPruneResult> {
  const current = config()
  const git = appGit()
  let pruned = 0
  for (const repo of localGitRepos(store.getRepos(), wanted)) {
    pruned += await pruneWorktreeSnapshots(git, repo, current.retentionDays, Date.now()).catch(
      () => 0
    )
  }
  return { pruned }
}

export async function restoreForkWorktreeSnapshot(
  store: RepoStore,
  params: { id: string; repo?: string; path?: string }
): Promise<ForkWorktreeSnapshotsRestoreResult> {
  const { snapshots } = await listForkWorktreeSnapshots(store, params.repo)
  const matches = snapshots.filter((snapshot) => snapshot.id === params.id)
  if (matches.length === 0) {
    throw new Error(`No snapshot ${params.id}. Run \`orca worktree snapshots\` to list them.`)
  }
  if (matches.length > 1) {
    throw new Error(`Snapshot ${params.id} exists in more than one project; pass --repo.`)
  }
  const snapshot = matches[0]
  const repo = localGitRepos(store.getRepos(), snapshot.repoId)[0]
  const target = params.path ?? snapshot.path
  if (await exists(target)) {
    throw new Error(`${target} already exists; pass --path to restore somewhere else.`)
  }
  const restored = await restoreWorktreeSnapshot(appGit(), repo.path, snapshot, target)
  return { snapshot, ...restored }
}
