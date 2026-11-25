// Completion contract (BAD-763): where a worker's done checks run. A git workspace is its checkout.
// A folder project has no checkout and no branch, but it is a real directory, and a command check
// runs there like anywhere else; only the pull request check has nothing to look at.
import type { ExecutionHostId } from '../../../shared/execution-host/execution-host'
import type { Repo } from '../../../shared/repository/repo-types'
import { hostedReviewSshConnectionId } from '../../source-control/hosted-review-execution-host'
import type { ProjectRuntimeResolutionStore } from '../../workspaces/execution-host/local-project-runtime-resolution'
import { getLocalProjectWorktreeGitOptions } from '../../workspaces/execution-host/project-runtime-git-options'
import type { CheckTarget } from './check-runner'
import { projectGroupIdFromRepoId } from '../../../shared/folder-workspaces/folder-workspace-worktree'
import { parseWslUncPath } from '../../../shared/file-access/wsl-paths'

export type GateWorkspaceRuntime = {
  resolveRuntimeFileTarget(selector: string): Promise<{
    worktree: { repoId: string; path: string; git: { branch: string } }
    executionHostId: ExecutionHostId
  }>
  store: () => ProjectRuntimeResolutionStore & { getRepo(repoId: string): Repo | undefined }
}

export type ResolvedGateWorkspace = {
  target: CheckTarget
  branch: string | null
  /** False for a folder project. */
  git: boolean
}

/** The directory, host and branch a done check runs against; null when the workspace is unknown. */
export function gateWorkspaceOf(
  worktree: { path: string; git?: { branch?: string } | null },
  repo: Pick<Repo, 'kind' | 'path'> | undefined,
  host: { connectionId: string | null; wslDistro?: string | undefined }
): ResolvedGateWorkspace | null {
  if (!repo) {
    return null
  }
  const folder = repo.kind === 'folder'
  // A folder workspace has no checkout of its own: it is the folder the project points at.
  const cwd = worktree.path || (folder ? repo.path : '')
  if (!cwd) {
    return null
  }
  const target: CheckTarget = {
    cwd,
    connectionId: host.connectionId,
    ...(host.wslDistro ? { wslDistro: host.wslDistro } : {})
  }
  return {
    target,
    branch: folder ? null : (worktree.git?.branch ?? '').replace(/^refs\/heads\//u, '') || null,
    git: !folder
  }
}

export async function resolveGateWorkspace(
  runtime: GateWorkspaceRuntime,
  worktreeId: string
): Promise<ResolvedGateWorkspace | null> {
  const { worktree, executionHostId } = await runtime.resolveRuntimeFileTarget(`id:${worktreeId}`)
  const connectionId = hostedReviewSshConnectionId(executionHostId)
  const repo = runtime.store().getRepo(worktree.repoId)
  if (!repo) {
    // BAD-798: a folder:<id> workspace (project group, bot home) names its group, not a repo.
    return projectGroupIdFromRepoId(worktree.repoId) === null
      ? null
      : folderGroupWorkspace(worktree.path, connectionId)
  }
  const { wslDistro } = getLocalProjectWorktreeGitOptions(runtime.store(), repo)
  return gateWorkspaceOf(worktree, repo, { connectionId, wslDistro })
}

/** A project group's folder workspace: its own folder, in WSL when the folder is a WSL path. */
function folderGroupWorkspace(
  folderPath: string,
  connectionId: string | null
): ResolvedGateWorkspace | null {
  if (!folderPath) {
    return null
  }
  const wsl = connectionId ? null : parseWslUncPath(folderPath)
  const target: CheckTarget = wsl
    ? { cwd: wsl.linuxPath, connectionId, wslDistro: wsl.distro }
    : { cwd: folderPath, connectionId }
  return { target, branch: null, git: false }
}
