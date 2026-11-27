// `fork.agent.close` (FORK.md, BAD-848): one chat by its Orca session ID, through the close the
// automation run sweep uses. A terminal agent is refused; its terminal has its own close.
import type {
  ForkAgentCloseParams,
  ForkAgentCloseResult
} from '../../../shared/fork/agent-chat-close'
import type { AgentSessionRecordStore } from '../../runtime/agent-session/records/agent-session-record-store'
import type { StructuredSessionSurfaceRuntime } from '../../runtime/agent-session/lifecycle/structured-agent-session-close'
import { resolveAgentConversation } from '../../runtime/agent-conversations/agent-conversation-address'
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
  const result = await closeFinishedChat(runtimeFinishedChatCloseDeps(records, surface), sessionId)
  return { ...result, sessionId }
}
