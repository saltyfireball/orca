// Letters and the board (FORK.md, SLRM-2389): the contract `orca letter`, `orca board`, paired
// hosts and the window share. The RPC methods and the window bridge carry these payloads.
import { z } from 'zod'
import {
  FORK_BOARD_BODY_MAX_CHARS,
  FORK_BOARD_NOTE_MAX_CHARS,
  FORK_BOARD_TITLE_MAX_CHARS,
  FORK_LETTER_MAX_CHARS,
  type ForkBoardAsk,
  type ForkLetter,
  type ForkLetterPartyKind
} from './letters'

export const FORK_LETTERS_METHODS = {
  send: 'fork.letters.send',
  list: 'fork.letters.list',
  chats: 'fork.letters.chats',
  /** A paired desktop hands this host a letter for one of its chats. */
  deliver: 'fork.letters.deliver',
  /** A paired desktop takes the letters this host's chats wrote to its chats. */
  collect: 'fork.letters.collect',
  boardAdd: 'fork.board.add',
  boardList: 'fork.board.list',
  boardClose: 'fork.board.close'
} as const

export const FORK_LETTERS_CHANNELS = {
  board: 'fork:letters:board',
  boardClose: 'fork:letters:boardClose',
  history: 'fork:letters:history',
  /** main -> renderer: letters or asks changed on this host; read again. */
  changed: 'fork:letters:changed'
} as const

const Id = z.string().min(1).max(512)
const LetterId = z.string().regex(/^[a-f0-9]{4,12}$/)

/** Who runs the command, as its environment says; the host checks it against its own chats. */
export const ForkLetterCaller = z
  .object({ sessionId: Id.optional(), paneKey: Id.optional() })
  .strict()
  .optional()

export const ForkLettersSendParams = z.object({
  to: Id,
  text: z.string().min(1).max(FORK_LETTER_MAX_CHARS),
  cite: LetterId.optional(),
  /** A paired server (environment id or name) the recipient lives on. */
  host: z.string().min(1).max(200).optional(),
  from: ForkLetterCaller
})

export const ForkLettersListParams = z.object({
  chat: Id.optional(),
  limit: z.number().int().min(1).max(500).optional()
})

export const ForkLettersChatsParams = z.object({})

const PartyKind = z.enum(['chat', 'terminal', 'shell'])

export const ForkLettersDeliverParams = z.object({
  id: z.string().regex(/^[a-f0-9]{12}$/),
  to: Id,
  text: z.string().min(1).max(FORK_LETTER_MAX_CHARS),
  cite: LetterId.optional(),
  from: z.object({
    chatId: Id,
    kind: PartyKind,
    title: z.string().max(200),
    agent: z.string().max(100)
  }),
  /** The sending desktop's own name for itself; shown, never trusted. */
  hostName: z.string().max(200)
})

export const ForkLettersCollectParams = z.object({})

export const ForkBoardAddParams = z.object({
  type: z.enum(['REVIEW', 'DECIDE', 'DO']),
  title: z.string().min(1).max(FORK_BOARD_TITLE_MAX_CHARS),
  body: z.string().max(FORK_BOARD_BODY_MAX_CHARS).optional(),
  from: ForkLetterCaller
})

export const ForkBoardListParams = z.object({
  /** Also the asks closed in the last week. */
  all: z.boolean().optional()
})

export const ForkBoardCloseParams = z.object({
  id: Id,
  action: z.enum(['done', 'back']),
  note: z.string().max(FORK_BOARD_NOTE_MAX_CHARS).optional(),
  from: ForkLetterCaller
})

export type ForkLettersSendRequest = z.infer<typeof ForkLettersSendParams>
export type ForkLettersDeliverRequest = z.infer<typeof ForkLettersDeliverParams>
export type ForkBoardAddRequest = z.infer<typeof ForkBoardAddParams>
export type ForkBoardCloseRequest = z.infer<typeof ForkBoardCloseParams>
export type ForkLetterCallerClaim = z.infer<typeof ForkLetterCaller>

export type ForkLetterChat = {
  id: string
  kind: Exclude<ForkLetterPartyKind, 'shell'>
  title: string
  agent: string
  workspace: string
  worktreeId: string | null
}

export type ForkLettersSendResult = { letter: ForkLetter }
export type ForkLettersListResult = { now: number; letters: ForkLetter[] }
export type ForkLettersChatsResult = { chats: ForkLetterChat[] }
export type ForkLettersCollectResult = { letters: ForkLetter[] }
export type ForkBoardAddResult = { ask: ForkBoardAsk }
export type ForkBoardListResult = { now: number; asks: ForkBoardAsk[] }
export type ForkBoardCloseResult = { ask: ForkBoardAsk }

/** Where a row the window shows lives: null is this host, else a paired server. */
export type ForkLettersSource = { environmentId: string; name: string } | null

export type ForkBoardViewAsk = ForkBoardAsk & { source: ForkLettersSource }
export type ForkLettersViewLetter = ForkLetter & { source: ForkLettersSource }

export type ForkBoardView = {
  now: number
  asks: ForkBoardViewAsk[]
  /** Paired servers that did not answer. */
  unreachable: string[]
}

export type ForkLettersHistoryView = {
  now: number
  letters: ForkLettersViewLetter[]
  unreachable: string[]
}

export type ForkBoardCloseWindowRequest = {
  id: string
  environmentId: string | null
  action: 'done' | 'back'
  note?: string
}

export type ForkBoardCloseWindowResult = { ok: true } | { ok: false; error: string }

/** `window.api.forkLetters`; desktop only. */
export type ForkLettersApi = {
  board: () => Promise<ForkBoardView>
  closeAsk: (request: ForkBoardCloseWindowRequest) => Promise<ForkBoardCloseWindowResult>
  history: (chatId: string | null) => Promise<ForkLettersHistoryView>
  onChanged: (listener: () => void) => () => void
}
