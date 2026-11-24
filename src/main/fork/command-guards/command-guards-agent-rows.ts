// Command guards (FORK.md, BAD-686): `orca agent list|show` rows carry the agent's guard line, read
// from this host's `fork.commandGuards.status`, so a row and the status can never disagree. Rows of
// another host are left without one: only that host can say. Keep electron out of this file.
import type { AgentConversationRow } from '../../../shared/agent-conversations/agent-conversation-contracts'
import { commandGuardAgentLine } from '../../../shared/fork/command-guards-agent-line'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host/execution-host'
import { agentHookServer } from '../../agent-hooks/server/agent-hook-server'
import { forkCommandGuardStatus, type ForkCommandGuardLiveAgent } from './command-guards-status'

/** Hook (agent-conversation-methods.ts): each row of this host with its `commandGuard` line. */
export function forkAgentRowsWithCommandGuards<T extends AgentConversationRow>(
  rows: T[],
  live: readonly ForkCommandGuardLiveAgent[] = agentHookServer.getStatusSnapshot()
): T[] {
  try {
    const status = forkCommandGuardStatus(live)
    return rows.map((row) => {
      if (row.hostId && row.hostId !== LOCAL_EXECUTION_HOST_ID) {
        return row
      }
      const line = commandGuardAgentLine(status, row)
      return line ? { ...row, commandGuard: line } : row
    })
  } catch {
    return rows
  }
}
