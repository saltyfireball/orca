// SLRM-2098 (FORK.md "Agent launch queue"): what counts toward the limit. Real process liveness
// only: a chat counts while this app owns its provider child (running or starting), a terminal
// while an agent runs in its pane. A chat that sleeps or was released has no child and so frees
// its slot, however it got there.
import type { AgentSessionStatusSummary } from '../../../shared/agent-session/agent-session-wire'
import type { ForkAgentQueueKind } from '../../../shared/fork/agent-queue'

type SummaryHost = {
  loadedSessionIds: () => readonly string[]
  readStatusSummary: (
    sessionId: string
  ) => Pick<AgentSessionStatusSummary, 'hostExecutionOwned'> | undefined
}

export type PtyLike = {
  readonly ptyId: string
  readonly connected: boolean
  readonly launchAgent: unknown
  readonly foregroundAgent?: unknown
}

export type LiveAgentSources = {
  host: SummaryHost | null | undefined
  ptys: ReadonlyMap<string, PtyLike> | undefined
  workerKind: (sessionId: string) => ForkAgentQueueKind
}

export function readLiveAgents(sources: LiveAgentSources): Map<string, ForkAgentQueueKind> {
  const live = new Map<string, ForkAgentQueueKind>()
  const { host, ptys } = sources
  if (host) {
    for (const sessionId of host.loadedSessionIds()) {
      if (host.readStatusSummary(sessionId)?.hostExecutionOwned === true) {
        live.set(sessionId, sources.workerKind(sessionId))
      }
    }
  }
  for (const pty of ptys?.values() ?? []) {
    if (pty.connected && (pty.launchAgent || pty.foregroundAgent)) {
      live.set(`pty:${pty.ptyId}`, 'interactive')
    }
  }
  return live
}
