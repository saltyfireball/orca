// SLRM-1503: the home a native Claude chat last launched under, which `fork.claudeAccount.which`
// reports so the account chip can name the account by its folder.
import type { AgentSessionRecord } from '../../../shared/agent-session/lifecycle/agent-session-record'
import { acquiredAgentSessionAccount } from '../../../shared/agent-session/lifecycle/agent-session-acquired-account'
import { agentSessionAccountHomePath } from '../../../shared/agent-session/lifecycle/agent-session-account-home'
import type { ForkClaudeLaunchHome } from '../../../shared/fork/claude-account-move'

/** The account a chat runs on: the one the host last launched it under, else its founding home. */
export function claudeChatLaunchHome(
  record: AgentSessionRecord | undefined | null,
  hostId: string | undefined
): ForkClaudeLaunchHome {
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
