/** Fork (SLRM-1503): the RPC a host answers with the Claude home one native chat launches under. */
export const FORK_CLAUDE_CHAT_HOME_METHOD = 'agentSession.forkClaudeHome'

/**
 * The folder the host last launched the chat's Claude under, in the host's own path syntax.
 * `accountId` is set when the host launched it on a managed account it named.
 * Null `home` means the chat is not a Claude chat or the host has no record of it.
 */
export type ForkClaudeChatHome = {
  home: string | null
  accountId: string | null
}
