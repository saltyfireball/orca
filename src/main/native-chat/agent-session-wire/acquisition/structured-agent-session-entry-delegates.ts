import type { StructuredAgentSessionCaller } from '../host/structured-agent-session-host-types'
import type { StructuredAgentSessionAttachContext } from './structured-agent-session-attach-context'
import type { AgentSessionAttachParams } from './structured-agent-session-attach'
import { attachStructuredAgentSession } from './structured-agent-session-attach-orchestration'
import {
  createStructuredAgentSession,
  type StructuredAgentSessionCreateOptions
} from './structured-agent-session-create'
import { noteForkMcpNewChat } from '../../../fork/mcp-profiles/mcp-profiles-service'

export function structuredAgentSessionEntryDelegates(
  context: () => StructuredAgentSessionAttachContext
) {
  return {
    attach: (
      caller: StructuredAgentSessionCaller,
      params: AgentSessionAttachParams,
      options?: Parameters<typeof attachStructuredAgentSession>[3]
    ) => attachStructuredAgentSession(context(), caller.callerKey, params, options),
    create: (
      caller: StructuredAgentSessionCaller,
      params: AgentSessionAttachParams,
      options?: StructuredAgentSessionCreateOptions
    ) => {
      // Fork (FORK.md "MCP profiles"): the launch kind and profile, before the first start.
      noteForkMcpNewChat(params.envelope.sessionId, params.agent)
      return createStructuredAgentSession(context(), caller, params, options)
    }
  }
}
