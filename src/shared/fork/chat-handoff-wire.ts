// Chat handoff (FORK.md, SLRM-2391): the fork.chatHandoff.* RPC contract behind the tab menu,
// `orca chat handoff` and `orca chat history`. Each host hands off and reads its own chats.
import { z } from 'zod'
import { CHAT_HANDOFF_MAX_REQUEST_CHARS, type ChatHandoffAgent } from './chat-handoff'
import type { ChatHandoffEntryRole } from './chat-handoff-select'

/** The most entries one `orca chat history` call returns. */
export const CHAT_HISTORY_MAX_LIMIT = 50
export const CHAT_HISTORY_DEFAULT_LIMIT = 20

const SessionIdParam = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid chat session id')

// Plain objects with no transforms or defaults: the mobile RPC fence refuses a schema whose parsed
// shape is wider than what a sender may send.
export const ForkChatHandoffStartParams = z
  .object({
    sessionId: SessionIdParam,
    to: z.enum(['claude', 'codex']),
    /** What the new agent is asked to do; never shortened. Absent: carry on. */
    request: z.string().max(CHAT_HANDOFF_MAX_REQUEST_CHARS).optional(),
    /** Start a fresh chat even when an earlier chat of the work could continue. */
    fresh: z.boolean().optional(),
    /** Stop the source chat's running turn first; without it a busy chat is refused. */
    stop: z.boolean().optional(),
    /** Show the new chat's tab. */
    focus: z.boolean().optional(),
    /** Plan and return the message, start nothing. */
    dryRun: z.boolean().optional()
  })
  .strict()

export const ForkChatHistoryParams = z
  .object({
    sessionId: SessionIdParam,
    /** Entries numbered below this; absent: the newest. */
    before: z.number().int().positive().optional(),
    limit: z.number().int().min(1).max(CHAT_HISTORY_MAX_LIMIT).optional()
  })
  .strict()

export type ChatHandoffRefusal =
  | 'disabled'
  | 'not-found'
  | 'unsupported-agent'
  | 'same-agent'
  | 'source-busy'
  | 'in-progress'
  | 'empty'
  | 'create-failed'
  | 'send-failed'

export type ChatHandoffStarted = {
  status: 'started' | 'planned'
  /** new: a fresh chat. continue: an earlier chat of the same work took the message. */
  mode: 'new' | 'continue'
  /** Why a fresh chat started though a linked one exists. */
  freshReason?: 'context-full' | 'asked'
  /** The chat that takes over (null on a dry run of a new chat). */
  sessionId: string | null
  agent: ChatHandoffAgent
  name: string
  /** Entries the message carries, and whether older ones were left out. */
  entries: number
  omittedOlder: boolean
  historyTokens: number
  budgetTokens: number
  /** continue only: sent at once, or held as a queued card while that chat is busy. */
  delivery?: 'sent' | 'queued'
  /** The source's running turn was stopped first. */
  stoppedSource: boolean
  /** The source's own resume at a usage limit reset was cancelled. */
  cancelledLimitResume: boolean
  /** Dry runs only: the whole message. */
  message?: string
}

export type ChatHandoffResult =
  | ChatHandoffStarted
  | { status: 'refused'; reason: ChatHandoffRefusal; message: string }

export type ChatHistoryEntry = {
  seq: number
  role: ChatHandoffEntryRole
  text: string
  /** The text was longer than one history read returns and was cut. */
  cut?: true
}

export type ChatHistoryResult = {
  sessionId: string
  agent: string
  name: string
  /** Newest last. */
  entries: ChatHistoryEntry[]
  /** Pass this to --before for the page before this one; null when this reached the start. */
  nextBefore: number | null
}
