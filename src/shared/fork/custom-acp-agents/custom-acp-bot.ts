// FORK.md "Custom ACP agents": a bot on `custom-acp` names which saved agent it runs.
import type { Bot } from '../../bots/bot-record-schemas'
import { CUSTOM_ACP_AGENT, CUSTOM_ACP_AGENT_OPTION_ID } from './custom-acp-agent-types'

/** Applies an update's `customAcpAgent` to `next` (already merged): null clears it, and a bot that
 *  no longer runs `custom-acp` keeps none, since the name belongs to that agent. */
export function applyForkCustomAcpBotUpdate(
  next: Bot,
  customAcpAgent: string | null | undefined
): void {
  if (customAcpAgent && next.agent === CUSTOM_ACP_AGENT) {
    next.customAcpAgent = customAcpAgent
  } else if (customAcpAgent !== undefined || next.agent !== CUSTOM_ACP_AGENT) {
    delete next.customAcpAgent
  }
}

/** The create option a bot's new chat carries to name its custom agent; none for other agents. */
export function forkCustomAcpBotOption(
  bot: Pick<Bot, 'agent' | 'customAcpAgent'>
): Record<string, string> {
  return bot.agent === CUSTOM_ACP_AGENT && bot.customAcpAgent
    ? { [CUSTOM_ACP_AGENT_OPTION_ID]: bot.customAcpAgent }
    : {}
}
