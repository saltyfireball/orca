// The newest rows of a native chat, for fork features that judge a chat by its latest turn
// (boundary compaction, idle recovery). Upstream 1.4.261 moved the transcript to SQLite and dropped
// the host's whole-journal `journalCurrentRead`; its own readers page through `history`, so this
// reads the same tail page an attaching client reads first.
import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../shared/agent-session/journal/agent-session-journal-types'
import { AGENT_SESSION_HISTORY_MAX_LIMIT } from '../../shared/agent-session/agent-session-wire'
import type { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-host'

export type ChatJournalTail = {
  items: readonly AgentJournalRenderItem[]
  submissions: readonly AgentJournalSubmission[]
}

/** The newest page of rows (at most AGENT_SESSION_HISTORY_MAX_LIMIT) and its submissions. */
export async function readChatJournalTail(
  host: Pick<StructuredAgentSessionHost, 'history'>,
  sessionId: string
): Promise<ChatJournalTail> {
  const result = await host.history({
    sessionId,
    direction: 'tail',
    limit: AGENT_SESSION_HISTORY_MAX_LIMIT
  })
  return { items: result.page.items, submissions: result.page.submissions }
}
