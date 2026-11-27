// BAD-873 (FORK.md "Custom ACP agents"): `orca bot set --bot <name> --agent <agent>` takes a bot
// agent id or the name of a custom ACP agent saved on the host.
import type { HandlerContext } from '../dispatch/dispatch'
import { RuntimeClientError } from '../runtime/connection/types'
import { isBotAgent } from '../../shared/bot-types'
import { CUSTOM_ACP_AGENT } from '../../shared/fork/custom-acp-agents/custom-acp-agent-types'
import type { ForkCustomAcpAgentsListResult } from '../../shared/fork/custom-acp-agents/custom-acp-agents-wire'
import { callCustomAcp } from './custom-acp-agent-handlers'

/** The bots.update fields a pick sets. */
export type ForkBotAgentPick = { agent: string; customAcpAgent: string | null }

export async function readForkBotAgentPick(
  ctx: Pick<HandlerContext, 'client'>,
  value: string
): Promise<ForkBotAgentPick> {
  const pick = value.trim()
  if (pick === CUSTOM_ACP_AGENT) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Name the custom agent itself (orca agent custom list), not custom-acp.'
    )
  }
  if (isBotAgent(pick)) {
    return { agent: pick, customAcpAgent: null }
  }
  const listed = await callCustomAcp<ForkCustomAcpAgentsListResult>(
    ctx,
    'fork.customAcpAgents.list',
    {}
  )
  if (!listed.result.agents.some((agent) => agent.name === pick)) {
    throw new RuntimeClientError(
      'invalid_argument',
      `${pick} is neither a bot agent nor a custom agent saved on this host (orca agent custom list).`
    )
  }
  return { agent: CUSTOM_ACP_AGENT, customAcpAgent: pick }
}
