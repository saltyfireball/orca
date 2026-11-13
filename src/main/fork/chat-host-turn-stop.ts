// Fork: stop the running turn of one native chat through its host's own cancel, the same path the
// chat's Stop button takes. Used by the Claude account move and by chat stall's Interrupt.
import { structuredAgentSessionPayloadFingerprint } from '../../shared/agent-session/lifecycle/structured-agent-session-mutation'
import type { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-host'
import { mintAgentSessionOperationId } from '../runtime/orchestration/mailbox/structured-pointer/structured-pointer-operation-id'

/** True when the host accepted the cancel; false for an unknown chat or a refused cancel. */
export async function forkStopChatTurn(
  host: StructuredAgentSessionHost,
  sessionId: string,
  callerKey: string
): Promise<boolean> {
  const fence = host.deps.store.getConversation(sessionId)?.currentFence
  if (fence === undefined) {
    return false
  }
  const result = await host
    .cancel(
      { callerKey },
      {
        envelope: {
          sessionId,
          clientOperationId: mintAgentSessionOperationId(Date.now()),
          expectedRuntimeFence: fence,
          payloadFingerprint: structuredAgentSessionPayloadFingerprint({
            method: 'agentSession.cancel',
            sessionId,
            fields: {}
          })
        }
      }
    )
    .catch(() => null)
  return result?.ok === true
}
