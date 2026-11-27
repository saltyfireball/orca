// `fork.agent.close` (FORK.md, BAD-848): one chat by its Orca session ID, through the close the
// automation run sweep uses. A terminal agent is refused; its terminal has its own close.
import type {
  ForkAgentCloseParams,
  ForkAgentCloseResult
} from '../../../shared/fork/agent-chat-close'
import type { AgentSessionRecordStore } from '../../runtime/agent-session/records/agent-session-record-store'
import type { StructuredSessionSurfaceRuntime } from '../../runtime/agent-session/lifecycle/structured-agent-session-close'
import { resolveAgentConversation } from '../../runtime/agent-conversations/agent-conversation-address'
import { noteForkGoalAgentsClosed } from '../goal-loop/goal-close-notes'
import { closeFinishedChat, runtimeFinishedChatCloseDeps } from './finished-chat-close'

export async function closeAgentChat(
  runtime: { openAgentSessionRecordStore(): Promise<AgentSessionRecordStore> },
  params: ForkAgentCloseParams,
  surface?: StructuredSessionSurfaceRuntime
): Promise<ForkAgentCloseResult> {
  const resolved = await resolveAgentConversation(runtime, params.id)
  if (resolved.kind !== 'chat') {
    return { closed: false, reason: 'not-a-chat' }
  }
  const sessionId = resolved.record.sessionId
  const records = await runtime.openAgentSessionRecordStore()
  const deps = runtimeFinishedChatCloseDeps(records, surface)
  // BAD-822: `orca agent close` is a close a person asks for, so a goal on this chat ends quietly.
  // The note goes in just before the close, so a chat refused as working is not noted. The
  // automation run sweep shares closeFinishedChat but is not a person, and notes nothing.
  const result = await closeFinishedChat(
    {
      ...deps,
      closeSession: (id) => {
        noteForkGoalAgentsClosed([id])
        return deps.closeSession(id)
      }
    },
    sessionId
  )
  return { ...result, sessionId }
}
