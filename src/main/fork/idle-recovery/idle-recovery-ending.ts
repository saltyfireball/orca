// Idle recovery (FORK.md), item B: what the classifier is shown of a chat.
// Contract: return the last request and the last assistant message of the chat (the caller
// cuts the tail and fingerprints it), or null when the ending cannot be read; a null ending is
// never classified. Read only.
// A native chat is read from its journal in memory, and only while its conversation is loaded.
// A terminal agent is read from the tail of its transcript file, else from the status row Orca
// keeps for its pane. One ending is read once: a chat that stays idle costs a map lookup.
import { agentSessionCurrentContextRows } from '../../../shared/agent-session/conversation-context/agent-session-context-clear'
import { readAgentMessageSource } from '../../../shared/agent-session/journal/agent-session-message-source'
import { isRootAgentJournalItem } from '../../../shared/agent-session/journal/agent-session-journal-producer'
import type { AgentJournalRenderItem } from '../../../shared/agent-session/journal/agent-session-journal-types'
import { isStructuredAgentSessionCommandEntry } from '../../../shared/agent-session/requests/structured-agent-session-command-entry'
import {
  IDLE_RECOVERY_MESSAGE_TAIL_CHARS,
  tailForIdleRecoveryClassifier
} from '../../../shared/fork/idle-recovery'
import { liveIdleRecoveryHost, type IdleRecoveryHost } from './idle-recovery-host'
import { readTranscriptEnding } from './idle-recovery-transcript-tail'
import type { IdleRecoveryCandidate, IdleRecoveryEnding } from './idle-recovery-types'

/** The end of a native chat, with whether its last request came from another agent. */
export type IdleRecoveryChatEnding = IdleRecoveryEnding & { fromAgent: boolean }

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

function bounded(ending: IdleRecoveryEnding): IdleRecoveryEnding {
  return {
    lastUserRequest: ending.lastUserRequest.slice(0, IDLE_RECOVERY_MESSAGE_TAIL_CHARS),
    lastAssistantMessage: tailForIdleRecoveryClassifier(ending.lastAssistantMessage)
  }
}

/**
 * The newest request of the chat's own agent (not a sub-agent's, not a `/command`) and the last
 * assistant message after it. Null when there is no request, or no answer to it yet.
 */
export function chatEndingFromJournal(
  items: readonly AgentJournalRenderItem[]
): IdleRecoveryChatEnding | null {
  const rows = agentSessionCurrentContextRows(items).items
  let assistant = ''
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const item = rows[index]
    if (!item || item.body.kind !== 'message' || !isRootAgentJournalItem(item)) {
      continue
    }
    if (item.body.role === 'assistant') {
      assistant ||= messageText(item)
    } else if (item.body.role === 'user' && !isStructuredAgentSessionCommandEntry(item.body)) {
      if (!assistant) {
        return null
      }
      return {
        ...bounded({ lastUserRequest: messageText(item), lastAssistantMessage: assistant }),
        fromAgent: readAgentMessageSource(item.body.from)?.kind === 'agent'
      }
    }
  }
  return null
}

type CachedEnding = { idleSince: number; ending: IdleRecoveryChatEnding | null }

const MAX_CACHED_ENDINGS = 2000
const cache = new Map<string, CachedEnding>()

/** Forgets every ending read so far (tests, and a sweep that is switched off). */
export function clearIdleRecoveryEndingCache(): void {
  cache.clear()
}

/** Drops the endings of chats that are no longer candidates. */
export function keepIdleRecoveryEndings(chatIds: ReadonlySet<string>): void {
  for (const chatId of cache.keys()) {
    if (!chatIds.has(chatId)) {
      cache.delete(chatId)
    }
  }
}

async function readTerminalEnding(
  host: IdleRecoveryHost,
  chat: Pick<IdleRecoveryCandidate, 'chatId' | 'lastPrompt'>
): Promise<IdleRecoveryChatEnding | null> {
  const status = await host.terminalStatus(chat.chatId)
  const prompt = status?.prompt.trim() || chat.lastPrompt.trim()
  const transcript = status?.transcriptPath
    ? await readTranscriptEnding(status.transcriptPath)
    : null
  const assistant = transcript?.lastAssistantMessage ?? status?.lastAssistantMessage?.trim() ?? ''
  if (!assistant) {
    return null
  }
  return {
    ...bounded({
      lastUserRequest: transcript?.lastUserRequest ?? prompt,
      lastAssistantMessage: assistant
    }),
    fromAgent: false
  }
}

/**
 * The ending of the turn that left `chat` idle at `idleSince`, read once and remembered until
 * the chat goes idle again at another time. A read that fails is not remembered.
 */
export async function readIdleRecoveryChatEnding(
  host: IdleRecoveryHost,
  chat: Pick<IdleRecoveryCandidate, 'chatId' | 'kind' | 'lastPrompt' | 'idleSince'>
): Promise<IdleRecoveryChatEnding | null> {
  const cached = cache.get(chat.chatId)
  if (cached && cached.idleSince === chat.idleSince) {
    return cached.ending
  }
  let ending: IdleRecoveryChatEnding | null
  try {
    if (chat.kind === 'chat') {
      const items = await host.chatJournal(chat.chatId)
      ending = items ? chatEndingFromJournal(items) : null
    } else {
      ending = await readTerminalEnding(host, chat)
    }
  } catch {
    return null
  }
  if (ending) {
    if (cache.size >= MAX_CACHED_ENDINGS) {
      cache.clear()
    }
    cache.set(chat.chatId, { idleSince: chat.idleSince, ending })
  }
  return ending
}

export async function readIdleRecoveryEndingWith(
  host: IdleRecoveryHost,
  candidate: IdleRecoveryCandidate
): Promise<IdleRecoveryEnding | null> {
  const ending = await readIdleRecoveryChatEnding(host, candidate)
  return ending
    ? { lastUserRequest: ending.lastUserRequest, lastAssistantMessage: ending.lastAssistantMessage }
    : null
}

export async function readIdleRecoveryEnding(
  candidate: IdleRecoveryCandidate
): Promise<IdleRecoveryEnding | null> {
  return readIdleRecoveryEndingWith(liveIdleRecoveryHost(), candidate)
}
