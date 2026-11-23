// Command guards (FORK.md, BAD-686): the workspaces whose terminal shell calls go through unchecked
// (no folder on this host), for the status's terminal row and each agent's guard line. A workspace
// leaves the list once no live agent runs in it. Keep electron out of this file.
import type { CommandGuardSurfaceCoverage } from '../../../shared/fork/command-guards'
import { sleeperChatSessionId } from '../../../shared/fork/sleepers-ps-sources'
import { forkLocalWorkspaceFolder } from '../workspace-folder/workspace-folder-path'

const MAX_UNGUARDED_WORKSPACES = 200
const unguardedTerminalWorkspaces = new Set<string>()

/** A terminal shell call whose workspace has no folder on this host went through unchecked. */
export function noteUnguardedTerminalWorkspace(workspaceId: string): void {
  unguardedTerminalWorkspaces.delete(workspaceId)
  unguardedTerminalWorkspaces.add(workspaceId)
  if (unguardedTerminalWorkspaces.size > MAX_UNGUARDED_WORKSPACES) {
    const oldest = unguardedTerminalWorkspaces.values().next().value
    if (oldest !== undefined) {
      unguardedTerminalWorkspaces.delete(oldest)
    }
  }
}

/** An agent status row of this host, for which workspaces still have a live agent. */
export type ForkCommandGuardLiveAgent = {
  worktreeId?: string
  paneKey: string
  agentType?: string
}

const CLAUDE_TERMINAL_TYPES = new Set(['claude', 'claude-agent-teams'])

/**
 * The workspaces whose terminal shell calls go through unchecked: those a call already went
 * through in, and those a live Claude terminal runs in with no folder here. A workspace with no
 * live agent any more drops out, so the status clears without a restart.
 */
export function terminalGaps(live: readonly ForkCommandGuardLiveAgent[]): string[] {
  for (const agent of live) {
    if (
      agent.worktreeId &&
      agent.agentType &&
      CLAUDE_TERMINAL_TYPES.has(agent.agentType) &&
      sleeperChatSessionId(agent.paneKey) === null &&
      !forkLocalWorkspaceFolder(agent.worktreeId)
    ) {
      noteUnguardedTerminalWorkspace(agent.worktreeId)
    }
  }
  const alive = new Set(live.flatMap((agent) => (agent.worktreeId ? [agent.worktreeId] : [])))
  for (const workspaceId of unguardedTerminalWorkspaces) {
    if (!alive.has(workspaceId)) {
      unguardedTerminalWorkspaces.delete(workspaceId)
    }
  }
  return [...unguardedTerminalWorkspaces]
}

/** The terminal row unguarded on Windows (its script cannot answer) and while any workspace is a gap. */
export function withTerminalGaps(
  rows: CommandGuardSurfaceCoverage[],
  gaps: number,
  platform: NodeJS.Platform
): CommandGuardSurfaceCoverage[] {
  return rows.map((row) => {
    if (row.surface !== 'terminal') {
      return row
    }
    if (platform === 'win32') {
      return {
        ...row,
        guarded: false,
        proof: null,
        note: "unguarded: Claude Code's Windows hook script cannot answer Orca"
      }
    }
    return gaps > 0
      ? {
          ...row,
          guarded: false,
          note: `unguarded: ${gaps} workspace${gaps === 1 ? '' : 's'} with no folder on this host (a folder workspace on an SSH host or in WSL, or one this host does not know) ran shell commands unchecked; ${row.note}`
        }
      : row
  })
}
