// FORK.md "Custom ACP agents": `orca agent custom ...` and the new-chat menu's custom agents. Each
// host answers from its own settings and env store, so a paired server runs its own agents.
import { defineMethod, InvalidArgumentError } from '../../core'
import {
  ForkCustomAcpAgentAddParams,
  ForkCustomAcpAgentRemoveParams,
  ForkCustomAcpAgentsListParams,
  ForkCustomAcpAgentStartChatParams
} from '../../../../../shared/fork/custom-acp-agents/custom-acp-agents-wire'
import {
  addForkCustomAcpAgent,
  CustomAcpAgentError,
  forkCustomAcpAgentRows,
  removeForkCustomAcpAgent,
  startForkCustomAcpChat
} from '../../../../fork/custom-acp-agents/custom-acp-agents-service'

const CALLER_KEY = 'trusted-local:fork-custom-acp-agents'

/** A refused request says why, as an invalid argument the CLI prints. */
async function plainly<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw error instanceof CustomAcpAgentError ? new InvalidArgumentError(error.message) : error
  }
}

export const FORK_CUSTOM_ACP_AGENT_METHODS = [
  defineMethod({
    name: 'fork.customAcpAgents.list',
    permission: 'workspace',
    params: ForkCustomAcpAgentsListParams,
    handler: async () => ({ agents: forkCustomAcpAgentRows() })
  }),
  defineMethod({
    name: 'fork.customAcpAgents.add',
    permission: 'workspace',
    params: ForkCustomAcpAgentAddParams,
    handler: (params, { runtime }) =>
      plainly(async () => ({ agent: await addForkCustomAcpAgent(runtime.requireStore(), params) }))
  }),
  defineMethod({
    name: 'fork.customAcpAgents.remove',
    permission: 'workspace',
    params: ForkCustomAcpAgentRemoveParams,
    handler: (params, { runtime }) =>
      plainly(() => removeForkCustomAcpAgent(runtime.requireStore(), params.name))
  }),
  defineMethod({
    name: 'fork.customAcpAgents.startChat',
    permission: 'workspace',
    params: ForkCustomAcpAgentStartChatParams,
    handler: (params, { runtime }) =>
      plainly(() => startForkCustomAcpChat(runtime, params, CALLER_KEY))
  })
] as const
