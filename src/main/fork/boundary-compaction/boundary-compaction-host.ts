// Boundary compaction (FORK.md): what the sweep asks of this process's chat host. Every read is
// of state the host already holds in memory, and only of chats whose agent runs here, so nothing
// is loaded or started. The one write is the host's own conversation command, the same call the
// composer's /compact makes. Tests pass a fake; `liveBoundaryCompactionHost` is the real one.
import { agentSessionConversationCommandFields } from '../../../shared/agent-session/agent-session-conversation-command'
import { agentSessionCurrentContextRows } from '../../../shared/agent-session/agent-session-context-clear'
import { contextTokensFromUsage } from '../../../shared/agent-session/agent-session-context-usage'
import { isRootAgentJournalItem } from '../../../shared/agent-session/journal/agent-session-journal-producer'
import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../../shared/agent-session/journal/agent-session-journal-types'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session/lifecycle/agent-session-mutation-envelope'
import { isQueuedAgentJournalSubmission } from '../../../shared/agent-session/requests/agent-session-queued-submission'
import { isStructuredAgentSessionCommandEntry } from '../../../shared/agent-session/structured-agent-session-command-entry'
import { latestStructuredAgentContextFacts } from '../../../shared/agent-session/structured-agent-session-context-usage'
import type { BoundaryCompactionJournalFacts } from '../../../shared/fork/boundary-compaction'
import type { StructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-host'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { liveIdleRecoveryHost } from '../idle-recovery/idle-recovery-host'
import { idleRecoveryChatPort } from '../idle-recovery/idle-recovery-ports'

const CALLER_KEY = 'trusted-local:fork-boundary-compaction'

/** What the host says of one chat whose agent runs here. */
export type BoundaryCompactionChatRest = {
  fence: number
  compactable: boolean
  awake: boolean
  inTurn: boolean
  backgroundRunning: boolean
  idleSince: number | null
}

/**
 * - started: the chat took the command and is compacting.
 * - refused: the host did not run it (the chat got busy, holds a message, or cannot compact now).
 * - unknown: the call failed after it may have reached the chat.
 */
export type BoundaryCompactionSendOutcome = 'started' | 'refused' | 'unknown'

export type BoundaryCompactionHost = {
  /** The chats whose agent process this host runs. Sleeping chats are not among them. */
  chatIds: () => readonly string[]
  /** Null when the chat is gone. */
  rest: (sessionId: string) => BoundaryCompactionChatRest | null
  /** Null when the chat's journal is not in memory. Never loads one. */
  journal: (sessionId: string) => Promise<BoundaryCompactionJournalFacts | null>
  compact: (
    sessionId: string,
    fence: number,
    operationId: string
  ) => Promise<BoundaryCompactionSendOutcome>
}

/**
 * The journal's side of the rule: the newest request of the chat's own agent, whether a command
 * followed it, whether a message waits in the queue, and the context size as last measured.
 */
export function boundaryCompactionJournalFacts(
  items: readonly AgentJournalRenderItem[],
  submissions: readonly AgentJournalSubmission[] = []
): BoundaryCompactionJournalFacts {
  const rows = agentSessionCurrentContextRows(items).items
  let requestItemId: string | null = null
  let commandSinceRequest = false
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const item = rows[index]
    if (!item || item.body.kind !== 'message' || item.body.role !== 'user') {
      continue
    }
    if (!isRootAgentJournalItem(item)) {
      continue
    }
    if (isStructuredAgentSessionCommandEntry(item.body)) {
      commandSinceRequest = true
      continue
    }
    requestItemId = item.itemId
    break
  }
  const used = latestStructuredAgentContextFacts(items).used
  let contextTokens: number | null = null
  if (used?.kind === 'report') {
    contextTokens = used.usedTokens
  } else if (used?.kind === 'estimate') {
    contextTokens = contextTokensFromUsage(used.usage)
  }
  return {
    requestItemId,
    commandSinceRequest,
    queued: submissions.some(isQueuedAgentJournalSubmission),
    contextTokens:
      contextTokens !== null && Number.isFinite(contextTokens) && contextTokens >= 0
        ? contextTokens
        : null,
    measuredAt: used && used.kind !== 'unknown' ? used.capturedAt : null
  }
}

export type BoundaryCompactionChatHost = Pick<
  StructuredAgentSessionHost,
  | 'conversationCommand'
  | 'journalCurrentRead'
  | 'readStatusSummary'
  | 'loadedSessionIds'
  | 'send'
  | 'waitForSendSettlement'
  | 'deps'
>

export function liveBoundaryCompactionHost(
  getHost: () => BoundaryCompactionChatHost | null = getStructuredAgentSessionHost
): BoundaryCompactionHost {
  const chatPort = idleRecoveryChatPort(getHost)
  const summaries = liveIdleRecoveryHost()
  const loaded = (sessionId: string): BoundaryCompactionChatHost | null => {
    const host = getHost()
    return host && host.loadedSessionIds().includes(sessionId) ? host : null
  }
  return {
    chatIds: () => getHost()?.loadedSessionIds() ?? [],
    rest: (sessionId) => {
      const host = getHost()
      // The same read idle recovery wakes on: the fence, whether the agent runs here, and a turn.
      const facts = chatPort.read(sessionId)
      const record = host?.deps.store.getRecord(sessionId)
      if (!host || !facts || !record) {
        return null
      }
      const summary = host.readStatusSummary(sessionId)
      const resting =
        summary?.status === 'idle' &&
        !facts.inTurn &&
        summary.stopping !== true &&
        summary.restartResume === undefined
      return {
        fence: facts.fence,
        compactable: host.deps.agents.capabilities(record.provider)?.compact === true,
        awake: facts.loaded && summary?.sleptAt === undefined,
        inTurn: !resting,
        // A running or monitoring child (a sub-agent, a scheduled or watched task) counts too.
        backgroundRunning:
          summaries.chatSummary(sessionId)?.backgroundRunning !== false ||
          (summary?.children ?? []).length > 0,
        // The status's own edge; `updatedAt` also moves when a child row changes, so it only
        // ever reads later.
        idleSince: resting ? (summary.statusStartedAt ?? summary.updatedAt) : null
      }
    },
    journal: async (sessionId) => {
      const host = loaded(sessionId)
      if (!host) {
        return null
      }
      const read = await host.journalCurrentRead(sessionId)
      return boundaryCompactionJournalFacts(read.items, read.submissions)
    },
    compact: async (sessionId, fence, operationId) => {
      const host = loaded(sessionId)
      if (!host) {
        return 'refused'
      }
      try {
        // No `userSend`: this is the host's own send, not a person's. No `delivery`: a chat that
        // got busy refuses the command instead of holding it as a queued card.
        const result = await host.conversationCommand(
          { callerKey: CALLER_KEY },
          {
            command: 'compact',
            envelope: {
              sessionId,
              clientOperationId: operationId,
              expectedRuntimeFence: fence,
              payloadFingerprint: computeAgentSessionPayloadFingerprint({
                method: 'agentSession.conversationCommand',
                sessionId,
                fields: agentSessionConversationCommandFields('compact')
              })
            }
          }
        )
        if (!result.ok) {
          return 'refused'
        }
        if (result.value.state !== 'completed') {
          return 'unknown'
        }
        // A completed answer with an error is a command the agent turned down.
        return result.value.error ? 'refused' : 'started'
      } catch {
        return 'unknown'
      }
    }
  }
}
