import type { AgentSessionRecord } from '../../../shared/agent-session/lifecycle/agent-session-record'
import { acquiredAgentSessionAccount } from '../../../shared/agent-session/lifecycle/agent-session-acquired-account'
import { agentSessionAccountHomePath } from '../../../shared/agent-session/lifecycle/agent-session-account-home'
import {
  FORK_CLAUDE_CHAT_HOME_METHOD,
  type ForkClaudeChatHome
} from '../../../shared/fork/claude-account-chip'
import { OptionsParams } from '../../../shared/rpc-contract/structured-agent-session-params'
import { defineMethod } from '../../runtime/rpc/core'
import { requireInstalledStructuredHost } from '../../runtime/rpc/methods/structured-sessions/creation/structured-agent-session-gate'

/** The account a chat runs on: the one the host last launched it under, else its founding home. */
export function claudeChatHome(
  record: AgentSessionRecord | undefined | null,
  hostId: string | undefined
): ForkClaudeChatHome {
  if (!record || record.provider !== 'claude') {
    return { home: null, accountId: null }
  }
  // Same order as acquiredAccountHome in main/ai-vault/structured-session-ownership.ts.
  const acquired = acquiredAgentSessionAccount(record, hostId)
  if (acquired) {
    return {
      home: acquired.recipe.home,
      accountId: acquired.recipe.route === 'managed' ? acquired.recipe.accountId : null
    }
  }
  return {
    home: agentSessionAccountHomePath(record.accountHome),
    accountId: null
  }
}

/** Fork (SLRM-1503): read-only, so the account chip can name a chat's account on any host. */
export const FORK_CLAUDE_CHAT_HOME_METHODS = [
  defineMethod({
    name: FORK_CLAUDE_CHAT_HOME_METHOD,
    permission: 'workspace',
    params: OptionsParams,
    handler: async ({ sessionId }, ctx): Promise<ForkClaudeChatHome> => {
      const host = await requireInstalledStructuredHost(ctx, sessionId)
      const store = host.deps.store
      return claudeChatHome(store.getRecord(sessionId), store.hostId)
    }
  })
]
