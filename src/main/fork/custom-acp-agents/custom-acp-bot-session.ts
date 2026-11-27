// FORK.md "Custom ACP agents": a bot's chats on a custom agent. A chat's pin names its agent, so a
// bot moved to another one opens a new Home chat; an agent that keeps its own persona gets only
// Orca's bot rules, never the bot's SOUL.md or MEMORY.md.
import type { Bot } from '../../../shared/bot-types'
import type { AgentSessionAccountHome } from '../../../shared/agent-session/lifecycle/accounts/agent-session-account-home'
import { CUSTOM_ACP_AGENT } from '../../../shared/fork/custom-acp-agents/custom-acp-agent-types'
import { botRulesBlock } from '../../bots/bot-preamble'
import { forkCustomAcpAgentNamed, forkCustomAcpAgentNameOfHome } from './custom-acp-agents-host'

type SessionRecord = { provider: string; accountHome: AgentSessionAccountHome }

/** Whether `record` runs the custom agent `bot` names now; always true for other agents. */
export function forkCustomAcpRecordRunsBot(
  record: SessionRecord,
  bot: Pick<Bot, 'agent' | 'customAcpAgent'>
): boolean {
  return (
    bot.agent !== CUSTOM_ACP_AGENT ||
    forkCustomAcpAgentNameOfHome(record.accountHome) === (bot.customAcpAgent ?? null)
  )
}

/** A bot chat's standing instructions when its custom agent keeps its own persona: the Tools and
 *  Rules only, and no per-turn SOUL.md or MEMORY.md notes. Null leaves the usual preamble. */
export function forkCustomAcpBotInstructions(
  bot: Bot | null,
  record: SessionRecord
): Promise<string | null> | null {
  if (!bot || record.provider !== CUSTOM_ACP_AGENT) {
    return null
  }
  const name = forkCustomAcpAgentNameOfHome(record.accountHome)
  if (!name || forkCustomAcpAgentNamed(name)?.ownsPrompt !== true) {
    return null
  }
  return Promise.resolve(botRulesBlock(CUSTOM_ACP_AGENT))
}
