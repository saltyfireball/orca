// BAD-848 (FORK.md "Auto-close finished automation run chats"): `fork.agent.close`, behind
// `orca agent close`.
import { defineMethod } from '../../core'
import {
  FORK_AGENT_CLOSE_METHOD,
  ForkAgentCloseParams
} from '../../../../../shared/fork/agent-chat-close'
import { closeAgentChat } from '../../../../fork/automation-run-close/agent-chat-close'

export const FORK_AGENT_CLOSE_METHODS = [
  defineMethod({
    name: FORK_AGENT_CLOSE_METHOD,
    permission: 'workspace',
    params: ForkAgentCloseParams,
    handler: (params, { runtime }) => closeAgentChat(runtime, params, runtime)
  })
] as const
