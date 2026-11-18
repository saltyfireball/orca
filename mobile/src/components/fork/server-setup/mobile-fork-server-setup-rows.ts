// Set up on a server (FORK.md, SLRM-2406) on the phone: which paired servers the run-target list
// offers "Set up on SERVER..." for, and the rows themselves. Pure, so tests need no React.
import {
  getRepoExecutionHostId,
  type ExecutionHostId
} from '../../../../../src/shared/execution-host/execution-host'
import { getProjectIdentityKey } from '../../../../../src/shared/project/host-setup/project-host-setup-projection'
import {
  checkForkCloneUrl,
  forkCloneUrlFromRepos
} from '../../../../../src/shared/fork/server-setup'
import type { MobileWorkspaceRepo } from '../../../new-workspace/creation/forms/new-worktree-modal-types'
import type { NewWorkspaceRunTargetOption } from '../../../new-workspace/source-selection/presentation/new-workspace-project-targets'

type ServerHostId = `runtime:${string}`

/** A "Set up on SERVER..." row of the run-target list. */
export type MobileForkServerSetupItem = {
  id: string
  label: string
  detail: string
  hostId: ServerHostId
  forkServerSetup: true
}

export function isMobileForkServerSetupItem(
  item: MobileForkServerSetupItem | NewWorkspaceRunTargetOption<MobileWorkspaceRepo>
): item is MobileForkServerSetupItem {
  return 'forkServerSetup' in item && item.forkServerSetup === true
}

export function mobileForkServerSetupItemId(hostId: ServerHostId): string {
  return `fork-setup:${hostId}`
}

/** The project's clone URL as the phone sees it, or '' when it has none a server may clone. */
export function mobileForkServerSetupUrl(
  repos: readonly MobileWorkspaceRepo[],
  projectId: string | null
): string {
  if (!projectId) {
    return ''
  }
  const project = repos.filter(
    (repo) => repo.kind !== 'folder' && getProjectIdentityKey(repo) === projectId
  )
  const url = forkCloneUrlFromRepos(project)
  return checkForkCloneUrl(url).ok ? url : ''
}

/**
 * Reachable servers whose own repo list has answered without the project: those are the ones a
 * set-up row is offered for. A server still listing is left out, so a slow answer never shows a
 * row for a project it already has.
 */
export function mobileForkServerSetupHosts(args: {
  serverHostIds: Iterable<ExecutionHostId>
  listedHostIds: { has: (hostId: ExecutionHostId) => boolean }
  repos: readonly MobileWorkspaceRepo[]
  projectId: string | null
}): ServerHostId[] {
  const { projectId } = args
  if (!projectId) {
    return []
  }
  const withProject = new Set(
    args.repos
      .filter((repo) => getProjectIdentityKey(repo) === projectId)
      .map((repo) => getRepoExecutionHostId(repo))
  )
  return [...args.serverHostIds].filter(
    (hostId): hostId is ServerHostId =>
      hostId.startsWith('runtime:') && args.listedHostIds.has(hostId) && !withProject.has(hostId)
  )
}

/** The repo a finished setup produced, once the server's list shows it. */
export function findMobileForkSetUpRepo(
  repos: readonly MobileWorkspaceRepo[],
  hostId: ExecutionHostId,
  projectId: string
): MobileWorkspaceRepo | undefined {
  return repos.find(
    (repo) => getRepoExecutionHostId(repo) === hostId && getProjectIdentityKey(repo) === projectId
  )
}
