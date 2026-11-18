// Chat handoff (FORK.md, SLRM-2391): `orca chat history`, the tool a chat that took over reads the
// older history of the chat it came from with. Pages go newest first by entry number; a message the
// page reader shortened is read whole from the journal, up to a cap.
import type { AgentJournalCursor } from '../../../shared/agent-session/journal/agent-session-journal-identity'
import { AGENT_SESSION_HISTORY_MAX_LIMIT } from '../../../shared/agent-session/agent-session-wire'
import {
  CHAT_HISTORY_DEFAULT_LIMIT,
  CHAT_HISTORY_MAX_LIMIT,
  type ChatHistoryEntry
} from '../../../shared/fork/chat-handoff-wire'
import { chatHandoffEntryOf, type ChatHistoryHost } from './chat-handoff-entries'

/** The longest text one entry returns; past it the entry says it was cut. */
export const CHAT_HISTORY_MAX_ENTRY_CHARS = 100_000
const MAX_PAGES = 10

export type ChatHistoryPage = { entries: ChatHistoryEntry[]; nextBefore: number | null }

async function wholeEntry(
  host: ChatHistoryHost,
  sessionId: string,
  itemId: string,
  fallback: ChatHistoryEntry
): Promise<ChatHistoryEntry> {
  try {
    const item = await host.historyItem(sessionId, itemId)
    const whole = item ? chatHandoffEntryOf(item) : null
    return whole ? { ...whole } : { ...fallback, cut: true }
  } catch {
    return { ...fallback, cut: true }
  }
}

function capped(entry: ChatHistoryEntry): ChatHistoryEntry {
  return entry.text.length > CHAT_HISTORY_MAX_ENTRY_CHARS
    ? { ...entry, text: entry.text.slice(0, CHAT_HISTORY_MAX_ENTRY_CHARS), cut: true }
    : entry
}

/** Up to `limit` entries numbered below `before` (the newest when absent), newest last. */
export async function readChatHistoryPage(
  host: ChatHistoryHost,
  sessionId: string,
  options: { before?: number; limit?: number }
): Promise<ChatHistoryPage> {
  const limit = Math.min(options.limit ?? CHAT_HISTORY_DEFAULT_LIMIT, CHAT_HISTORY_MAX_LIMIT)
  const tail = await host.history(
    { sessionId, direction: 'tail', limit: AGENT_SESSION_HISTORY_MAX_LIMIT },
    'own-agent'
  )
  let page = tail.page
  if (options.before !== undefined) {
    const cursor: AgentJournalCursor = { epoch: tail.page.epoch, sequence: options.before }
    const result = await host.history(
      { sessionId, direction: 'before', cursor, limit: AGENT_SESSION_HISTORY_MAX_LIMIT },
      'own-agent'
    )
    if (!result.ok) {
      return { entries: [], nextBefore: null }
    }
    page = result.page
  }
  const entries: ChatHistoryEntry[] = []
  for (let read = 0; read < MAX_PAGES; read += 1) {
    for (let index = page.items.length - 1; index >= 0 && entries.length < limit; index -= 1) {
      const item = page.items[index]
      if (options.before !== undefined && item.sequence >= options.before) {
        continue
      }
      const entry = chatHandoffEntryOf(item)
      if (!entry) {
        continue
      }
      entries.unshift(
        capped(item.shortened ? await wholeEntry(host, sessionId, item.itemId, entry) : entry)
      )
    }
    if (entries.length >= limit || !page.hasOlder || page.items.length === 0) {
      break
    }
    const result = await host.history(
      {
        sessionId,
        direction: 'before',
        cursor: page.window.nextCursor,
        limit: AGENT_SESSION_HISTORY_MAX_LIMIT
      },
      'own-agent'
    )
    if (!result.ok) {
      break
    }
    page = result.page
  }
  const oldest = entries[0]?.seq
  const more =
    oldest !== undefined && (page.hasOlder || page.items.some((i) => i.sequence < oldest))
  return { entries, nextBefore: more ? oldest : null }
}
