// Sleepers (FORK.md): the sleep service wired to this process's chat host and idle sweep. Each
// runtime (the desktop, orcad, a paired host) answers for its own chats only. The desktop dialog
// and `orca sleepers` both reach it through the fork.sleepers.* RPC.
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import type { SleeperChatHostFact } from '../../../shared/fork/sleepers-ps-sources'
import type { ForkSleepersServiceDeps } from './sleepers-service'
import { forkSleepersSweep } from './sleepers-sweep-registry'

export function forkSleepersServiceDeps(): ForkSleepersServiceDeps {
  const sweep = forkSleepersSweep()
  return {
    chatState: (sessionId) => {
      const host = getStructuredAgentSessionHost()
      if (!host) {
        return null
      }
      const summary = host.readStatusSummary(sessionId)
      return {
        known: Boolean(host.deps.store.getRecord(sessionId)),
        processAlive: host.loadedSessionIds().includes(sessionId),
        busy: summary?.status === 'working' || summary?.hostExecutionPhase === 'starting'
      }
    },
    sweepNow: sweep ? (sessionId) => sweep.sweepNow(sessionId) : null
  }
}

/** The chats whose provider runs on this host, with the model each one runs. */
export function forkSleeperChatFacts(): Map<string, SleeperChatHostFact> {
  const facts = new Map<string, SleeperChatHostFact>()
  const host = getStructuredAgentSessionHost()
  for (const sessionId of host?.loadedSessionIds() ?? []) {
    const summary = host?.readStatusSummary(sessionId)
    facts.set(sessionId, { model: summary?.reportedModel ?? summary?.model ?? null })
  }
  return facts
}
