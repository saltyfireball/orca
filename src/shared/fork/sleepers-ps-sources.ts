// Sleepers (FORK.md): turn a runtime's agent rows (`worktree.ps`) into sleeper sources. Native
// chats are named by session id, terminal agents by pane key. Subagent rows are skipped: they
// live inside their lead's process and sleep with it.
import { structuredAgentSessionIdFromTabId } from '../agent-session/view/structured-agent-session-tab-id'
import { LOCAL_EXECUTION_HOST_ID } from '../execution-host'
import type {
  RuntimeWorktreeAgentRow,
  RuntimeWorktreePsSummary
} from '../runtime-worktree-contracts'
import type { SleeperSource } from './sleepers'

/** What this process's chat host says of a chat whose provider runs. */
export type SleeperChatHostFact = { model: string | null }

export function sleeperChatSessionId(paneKey: string): string | null {
  const colon = paneKey.indexOf(':')
  return structuredAgentSessionIdFromTabId(colon === -1 ? paneKey : paneKey.slice(0, colon))
}

export function sleeperTitle(
  row: Pick<
    RuntimeWorktreeAgentRow,
    'conversationName' | 'displayName' | 'taskTitle' | 'prompt' | 'agentType'
  >
): string {
  const title =
    row.conversationName?.trim() ||
    row.displayName?.trim() ||
    row.taskTitle?.trim() ||
    row.prompt.trim().slice(0, 80)
  return title || row.agentType || 'agent'
}

type PsWorktree = Pick<
  RuntimeWorktreePsSummary,
  'worktreeId' | 'displayName' | 'repo' | 'hostId'
> & {
  agents?: readonly RuntimeWorktreeAgentRow[]
}

export function sleeperSourcesFromPs(
  worktrees: readonly PsWorktree[],
  chatFacts: ReadonlyMap<string, SleeperChatHostFact>
): SleeperSource[] {
  const sources: SleeperSource[] = []
  for (const worktree of worktrees) {
    const workspace = worktree.displayName || worktree.repo || worktree.worktreeId
    const localHost = !worktree.hostId || worktree.hostId === LOCAL_EXECUTION_HOST_ID
    for (const row of worktree.agents ?? []) {
      if (row.parentPaneKey) {
        continue
      }
      const sessionId = sleeperChatSessionId(row.paneKey)
      const fact = sessionId ? chatFacts.get(sessionId) : undefined
      const base = {
        paneKey: row.paneKey,
        worktreeId: worktree.worktreeId,
        workspace,
        title: sleeperTitle(row),
        agent: row.agentType,
        status: row.state,
        stateStartedAt: row.stateStartedAt,
        updatedAt: row.updatedAt
      }
      if (sessionId) {
        sources.push({
          ...base,
          id: sessionId,
          kind: 'chat',
          model: fact?.model ?? null,
          processAlive: fact !== undefined || row.structuredHostOwned === true,
          local: localHost || fact !== undefined
        })
      } else {
        sources.push({
          ...base,
          id: row.paneKey,
          kind: 'terminal',
          model: null,
          processAlive: row.state !== 'done' || row.hasLivePty === true,
          local: localHost
        })
      }
    }
  }
  return sources
}
