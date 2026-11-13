// SLRM-2099: native chats as process-tree roots. Upstream's memory collector only knows PTYs, so a
// chat's provider process (and everything it starts) was never counted. The chat host is wired in
// from the main process at startup; the collector itself stays free of it.
import { isLocalExecutionHost } from '../../../shared/execution-host'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import { TUI_AGENT_CONFIG } from '../../../shared/agent-launch/catalog/tui-agent-config'
import { normalizeProcessName } from './process-table'
import type { ForkSessionRoot } from './attribution'

/** The parts of a stored chat record this reads. */
export type ForkChatRecordView = {
  sessionId: string
  provider: string
  location: {
    executionHostId: string
    wslDistro: string | null
    workspaceId: string
    workspaceKind: 'git-worktree' | 'folder'
  }
  lease: {
    claimStatus: 'reserved' | 'live' | 'conflicted' | 'released'
    ownerProcess: { hostId: string; pid: number } | null
  }
}

export type ForkChatRecordSource = () => { hostId: string | null; records: ForkChatRecordView[] }

let source: ForkChatRecordSource | null = null

export function installForkChatRecordSource(next: ForkChatRecordSource | null): void {
  source = next
}

/** Same id the terminal side uses: a worktree id, or `folder:<id>` for a folder workspace. */
export function chatWorkspaceKey(location: ForkChatRecordView['location']): string | null {
  if (!location.workspaceId) {
    return null
  }
  if (location.workspaceKind === 'folder' && !location.workspaceId.startsWith('folder:')) {
    return folderWorkspaceKey(location.workspaceId)
  }
  return location.workspaceId
}

/** Local chats whose provider process is running on this machine. Remote and WSL chats run where
 *  this host cannot measure them, and a released or reserved lease has no process to count. */
export function chatRootsFromRecords(
  records: readonly ForkChatRecordView[],
  hostId: string | null
): ForkSessionRoot[] {
  const roots: ForkSessionRoot[] = []
  for (const record of records) {
    const owner = record.lease.ownerProcess
    if (
      !owner ||
      !(owner.pid > 1) ||
      record.lease.claimStatus === 'released' ||
      record.location.wslDistro !== null ||
      !isLocalExecutionHost(record.location.executionHostId) ||
      (hostId !== null && owner.hostId !== hostId)
    ) {
      continue
    }
    roots.push({
      key: `chat:${record.sessionId}`,
      kind: 'chat',
      sessionId: record.sessionId,
      worktreeId: chatWorkspaceKey(record.location),
      provider: record.provider,
      pid: owner.pid
    })
  }
  return roots
}

export function readForkChatRoots(): ForkSessionRoot[] {
  if (!source) {
    return []
  }
  try {
    const { hostId, records } = source()
    return chatRootsFromRecords(records, hostId)
  } catch (err) {
    console.warn('[memory] chat sessions unreadable', err)
    return []
  }
}

let agentNames: Set<string> | null = null

/** Executable names of every agent CLI Orca can launch. */
export function forkAgentProcessNames(): ReadonlySet<string> {
  if (!agentNames) {
    agentNames = new Set(
      Object.values(TUI_AGENT_CONFIG)
        .map((config) => normalizeProcessName(config.expectedProcess ?? ''))
        .filter((name) => name.length > 0)
    )
  }
  return agentNames
}
