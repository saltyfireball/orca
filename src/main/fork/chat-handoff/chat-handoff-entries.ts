// Chat handoff (FORK.md, SLRM-2391): a chat's journal as handoff entries. Only the chat's own agent
// counts (no sub-agent rows): its requests and answers in full, and each tool call or file edit as
// one line. Reads go through the host's `history`, the page reader every client uses, so a chat at
// rest is read from its store without starting its agent.
import { isAgentSessionContextClear } from '../../../shared/agent-session/conversation-context/agent-session-context-clear'
import type { AgentJournalCursor } from '../../../shared/agent-session/journal/agent-session-journal-identity'
import { isRootAgentJournalItem } from '../../../shared/agent-session/journal/agent-session-journal-producer'
import type { AgentJournalRenderItem } from '../../../shared/agent-session/journal/agent-session-journal-types'
import { AGENT_SESSION_HISTORY_MAX_LIMIT } from '../../../shared/agent-session/agent-session-wire'
import { isStructuredAgentSessionCommandEntry } from '../../../shared/agent-session/requests/structured-agent-session-command-entry'
import {
  historyCommand,
  isChatHandoffMessage,
  type ChatHandoffEntry
} from '../../../shared/fork/chat-handoff-select'
import type { StructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-host'

export type ChatHistoryHost = Pick<StructuredAgentSessionHost, 'history' | 'historyItem'>

/** Pages of 200 rows read back for one handoff at most; older history is left to the tool. */
export const CHAT_HANDOFF_MAX_PAGES = 10

function messageText(item: AgentJournalRenderItem): string {
  if (item.body.kind !== 'message') {
    return ''
  }
  const parts: string[] = []
  for (const block of item.body.blocks) {
    if (block.type === 'text') {
      parts.push(block.text)
    }
  }
  return parts.join('\n').trim()
}

function inputSummary(input: unknown): string {
  if (typeof input === 'object' && input !== null) {
    const record = input as Record<string, unknown>
    for (const key of ['command', 'cmd', 'file_path', 'path', 'pattern', 'url', 'query']) {
      if (typeof record[key] === 'string') {
        return record[key]
      }
    }
  }
  try {
    return JSON.stringify(input) ?? ''
  } catch {
    return ''
  }
}

/** One journal row as an entry, or null for rows a handoff leaves out. */
export function chatHandoffEntryOf(item: AgentJournalRenderItem): ChatHandoffEntry | null {
  if (!isRootAgentJournalItem(item)) {
    return null
  }
  const body = item.body
  if (body.kind === 'message') {
    if (body.role !== 'user' && body.role !== 'assistant') {
      return null
    }
    if (isStructuredAgentSessionCommandEntry(body)) {
      return null
    }
    const text = messageText(item)
    if (!text) {
      return null
    }
    const role = body.role === 'user' && isChatHandoffMessage(text) ? 'handoff' : body.role
    return { seq: item.sequence, role, text }
  }
  if (body.kind === 'tool-call') {
    const outcome =
      body.state === 'running'
        ? 'running'
        : body.state === 'failed'
          ? 'failed'
          : body.exitCode !== undefined
            ? `exit ${body.exitCode}`
            : 'done'
    return {
      seq: item.sequence,
      role: 'activity',
      text: `${body.name} ${inputSummary(body.input)} -> ${outcome}`
    }
  }
  if (body.kind === 'diff') {
    return { seq: item.sequence, role: 'activity', text: `edited ${body.path}` }
  }
  return null
}

/** Entries of `items`, oldest first, with a note on any the page shortened. */
export function chatHandoffEntriesOf(
  items: readonly AgentJournalRenderItem[],
  sourceId: string
): ChatHandoffEntry[] {
  const entries: ChatHandoffEntry[] = []
  for (const item of items) {
    const entry = chatHandoffEntryOf(item)
    if (!entry) {
      continue
    }
    entries.push(
      item.shortened && entry.role !== 'activity'
        ? {
            ...entry,
            text: `${entry.text} [shortened; read it whole with: ${historyCommand(sourceId, entry.seq + 1, 1)}]`
          }
        : entry
    )
  }
  return entries
}

export type ChatHandoffRead = {
  /** Oldest first. */
  items: AgentJournalRenderItem[]
  /** The rows reach the conversation's start, or its latest /clear. */
  complete: boolean
}

/**
 * The chat's rows from the newest back, at most `maxPages` pages, stopping at its latest context
 * clear (what came before a /clear is not part of the work). `after` keeps only rows numbered
 * above it, for a handoff back that carries what is new.
 */
export async function readChatHandoffRows(
  host: Pick<ChatHistoryHost, 'history'>,
  sessionId: string,
  options: { maxPages?: number; after?: number } = {}
): Promise<ChatHandoffRead> {
  const maxPages = options.maxPages ?? CHAT_HANDOFF_MAX_PAGES
  const after = options.after ?? 0
  const items: AgentJournalRenderItem[] = []
  let cursor: AgentJournalCursor | undefined
  for (let page = 0; page < maxPages; page += 1) {
    const result = await host.history(
      cursor
        ? { sessionId, direction: 'before', cursor, limit: AGENT_SESSION_HISTORY_MAX_LIMIT }
        : { sessionId, direction: 'tail', limit: AGENT_SESSION_HISTORY_MAX_LIMIT },
      'own-agent'
    )
    if (cursor && !result.ok) {
      // A reset answers with a tail page; splicing it would repeat rows.
      return { items, complete: false }
    }
    const rows = result.page.items
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index]
      if (row.sequence <= after || isAgentSessionContextClear(row.body)) {
        return { items, complete: true }
      }
      items.unshift(row)
    }
    if (!result.page.hasOlder) {
      return { items, complete: true }
    }
    if (rows.length === 0) {
      return { items, complete: false }
    }
    cursor = result.page.window.nextCursor
  }
  return { items, complete: false }
}
