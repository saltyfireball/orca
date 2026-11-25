import type { StructuredAgentSessionCaller } from '../host/structured-agent-session-host-types'
import type { StructuredAgentSessionAttachContext } from './structured-agent-session-attach-context'
import type { AgentSessionAttachParams } from './structured-agent-session-attach'
import { attachStructuredAgentSession } from './structured-agent-session-attach-orchestration'
import {
  createStructuredAgentSession,
  type StructuredAgentSessionCreateOptions
} from './structured-agent-session-create'
import { noteForkMcpNewChat } from '../../../fork/mcp-profiles/mcp-profiles-service'
import { forkAgentProfileChatCreate } from '../../../fork/agent-profiles/agent-profile-launch-apply'
import { forkPauseAllHeldLaunchHost } from '../../../fork/pause-all/pause-all-held-launches'

export function structuredAgentSessionEntryDelegates(
  context: () => StructuredAgentSessionAttachContext
) {
  // Fork (BAD-818): Pause all starts a worker launch it held across a restart through this host.
  forkPauseAllHeldLaunchHost(context)
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
      // Fork (BAD-741): a --profile launch's permission mode and Claude account pin.
      return forkAgentProfileChatCreate(params, (next) =>
        createStructuredAgentSession(context(), caller, next, options)
      )
    }
  }
}
