// SLRM-2098 (FORK.md "Agent launch queue"): the hook in claimStructuredAgentSessionAgent, the
// one funnel every native chat provider start (Claude, Codex, ACP, pi) passes: queued
// messages, provider operations, worker preambles and the first message of a new chat.
import type { StructuredAgentSessionAttachContext } from '../../native-chat/agent-session-wire/acquisition/structured-agent-session-attach-context'
import type {
  StructuredAgentSessionResumeOutcome,
  StructuredAgentSessionStartClaim
} from '../../native-chat/agent-session-wire/startup/structured-agent-session-agent-start'
import { refusedStructuredAgentSessionStart } from '../../native-chat/agent-session-wire/startup/structured-agent-session-start-eligibility'
import { forkAgentQueueStart } from './agent-queue-service'

type Outcome = StructuredAgentSessionResumeOutcome

/** A chat that ran a provider before is woken, not launched: it has a provider conversation or an ended child. */
function isResume(
  context: Pick<StructuredAgentSessionAttachContext, 'deps' | 'sessions'>,
  sessionId: string
): boolean {
  if (context.sessions.get(sessionId)?.lastEndedChild) {
    return true
  }
  try {
    return (context.deps.store.getRecord(sessionId)?.providerHandleChain.length ?? 0) > 0
  } catch {
    return false
  }
}

export function forkAgentQueueClaimStart(
  context: Pick<StructuredAgentSessionAttachContext, 'deps' | 'sessions' | 'serialize'>,
  sessionId: string,
  start: (refused?: Outcome) => Promise<Outcome>,
  claimAgain: () => StructuredAgentSessionStartClaim
): StructuredAgentSessionStartClaim {
  return {
    outcome: forkAgentQueueStart<Outcome>({
      sessionId,
      resume: () => isResume(context, sessionId),
      start,
      // The ticket settled: claim again in the session's ordered lane, as the first claim ran.
      reclaim: () =>
        context.serialize(sessionId, async () => claimAgain()).then((claim) => claim.outcome),
      cancelled: () =>
        refusedStructuredAgentSessionStart(
          'agent_session_operation_invalid',
          // No reason names a queue cancel; this one's client words offer a retry, which is right.
          { reason: 'operationRefusedEarlier' },
          // Logs and older clients print this; newer clients word it from the reason.
          'This launch was cancelled in the agent queue before it started.'
        )
    })
  }
}
