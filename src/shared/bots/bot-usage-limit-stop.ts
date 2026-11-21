// A bot chat, worker or run stopped on its agent's usage limit, as its host's status feed says it.
import type { AgentSessionStatusSummary } from '../agent-session/agent-session-wire'
import type { AgentSessionStatusSnapshot } from '../agent-session/view/agent-session-status-snapshot-fold'

/** `at`: when Orca continues it (`auto`), else when the limit resets. */
export type UsageLimitStop = { at: number; auto: boolean }

/** A session's stop while its limit still holds. A scheduled continue stays a stop past its time,
 *  for the host publishes it only until the chat is continued or the continue lapses (BAD-707). */
export function usageLimitStopOf(
  summary: Pick<AgentSessionStatusSummary, 'usageLimitContinue'> | undefined,
  now: number
): UsageLimitStop | null {
  const cut = summary?.usageLimitContinue
  if (!cut) {
    return null
  }
  const stop =
    cut.state === 'scheduled'
      ? { at: cut.continueAt ?? cut.resetsAt, auto: true }
      : { at: cut.resetsAt, auto: false }
  return stop.auto || stop.at > now ? stop : null
}

/** A stopped session of the bot's, with the name its row would say. */
export type NamedUsageLimitStop = UsageLimitStop & {
  sessionId: string
  name: string | null
  agent: AgentSessionStatusSummary['agent']
}

/** Every stopped session the host lists, with its workspace, soonest first. */
export function usageLimitStops(
  sessions: AgentSessionStatusSnapshot,
  now: number
): (NamedUsageLimitStop & { workspaceId: string })[] {
  const stops: (NamedUsageLimitStop & { workspaceId: string })[] = []
  for (const summary of sessions.values()) {
    const stop = usageLimitStopOf(summary, now)
    if (stop) {
      stops.push({
        ...stop,
        sessionId: summary.sessionId,
        workspaceId: summary.workspaceId,
        name: summary.conversationName ?? null,
        agent: summary.agent
      })
    }
  }
  return stops.sort((a, b) => a.at - b.at || a.sessionId.localeCompare(b.sessionId))
}
