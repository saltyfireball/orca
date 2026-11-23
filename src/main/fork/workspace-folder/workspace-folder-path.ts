// BAD-678 (FORK.md "Turn checkpoints", "Command guards"): the folder an agent's workspace id names
// on this host, for fork features keyed by a status row's or hook's workspace id. A worktree id
// names its path; a `folder:<id>` folder workspace is looked up the way a terminal's start folder
// is. Keep electron out of this file.
import type { FolderWorkspace } from '../../../shared/folder-workspaces/folder-workspace-types'
import { getFolderWorkspaceHostId } from '../../../shared/folder-workspaces/folder-workspace-host-id'
import type { ProjectGroup } from '../../../shared/project/groups/project-group-types'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host/execution-host'
import { isWslUncPath } from '../../../shared/file-access/wsl-paths'
import { resolveTerminalWorkspacePath } from '../../../shared/shell/launch/terminal-startup-cwd'

export type ForkWorkspaceFolderStore = {
  getFolderWorkspace?: (id: string) => FolderWorkspace | undefined
  getProjectGroups?: () => ProjectGroup[]
}

export type ForkWorkspaceFolderRuntime = { requireStore: () => ForkWorkspaceFolderStore }

let runtime: ForkWorkspaceFolderRuntime | null = null

/** Points the lookup at this host's store; until then a folder workspace resolves to nothing. */
export function installForkWorkspaceFolders(next: ForkWorkspaceFolderRuntime | null): void {
  runtime = next
}

function localFolderOf(folderWorkspaceId: string): string | null {
  try {
    const store = runtime?.requireStore()
    const folder = store?.getFolderWorkspace?.(folderWorkspaceId)
    if (!folder?.folderPath || isWslUncPath(folder.folderPath)) {
      return null
    }
    const host = getFolderWorkspaceHostId(folder, store?.getProjectGroups?.() ?? [])
    return host === LOCAL_EXECUTION_HOST_ID ? folder.folderPath : null
  } catch {
    return null
  }
}

/**
 * The folder on this host that `workspaceId` (a worktree id or `folder:<id>`) works in; null when
 * none resolves, as for an unknown folder workspace or one on an SSH host or in a WSL distro.
 */
export function forkLocalWorkspaceFolder(workspaceId: string | null | undefined): string | null {
  const path = resolveTerminalWorkspacePath(workspaceId ?? undefined, localFolderOf)
  return path && path.length > 0 ? path : null
}
