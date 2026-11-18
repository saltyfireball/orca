// Letters and the board (FORK.md, SLRM-2389): the settings, the shapes and the pure rules. A
// letter is one chat's message to another chat, on this host or a paired one; it is delivered
// only between the recipient's turns. The board holds typed asks agents file for the user
// (REVIEW, DECIDE, DO). Everything here is pure, so the main process, the CLI and the window
// share it. The idea comes from John's archived ccdeck (server/letters.ts, server/board.ts).

export type ForkLettersSettings = {
  /** Fork (SLRM-2389): chats and workers send each other letters with `orca letter send`, delivered between turns; unset is on. */
  forkLetters?: boolean
  /** Fork letters: letters (and board asks) one chat may send in the rate window; unset is 20. */
  forkLettersMaxPerWindow?: number
  /** Fork letters: the rate window in minutes; unset is 10. */
  forkLettersWindowMinutes?: number
  /** Fork letters: letters each way between two chats in the rate window that count as a loop and are refused; unset is 6. */
  forkLettersLoopEach?: number
  /** Fork letters: take letters from chats on a paired host; unset is on. */
  forkLettersFromPaired?: boolean
  /** Fork board (SLRM-2389): agents file REVIEW, DECIDE and DO asks for you with `orca board add`, shown above the composer and in the Decision inbox; unset is on. */
  forkBoard?: boolean
  /** Fork board: open asks one chat may have at once; unset is 10. */
  forkBoardMaxOpenPerChat?: number
}

export type ForkLettersConfig = {
  letters: boolean
  maxPerWindow: number
  windowMs: number
  loopEach: number
  fromPaired: boolean
  board: boolean
  maxOpenPerChat: number
}

type Key = keyof ForkLettersSettings
export type ForkLettersSettingsSource = Partial<Record<Key, unknown>> | null | undefined

function whole(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback
}

export function readForkLettersSettings(source: ForkLettersSettingsSource): ForkLettersConfig {
  const s: Partial<Record<Key, unknown>> = source ?? {}
  return {
    letters: s.forkLetters !== false,
    maxPerWindow: whole(s.forkLettersMaxPerWindow, 1, 200, 20),
    windowMs: whole(s.forkLettersWindowMinutes, 1, 1440, 10) * 60_000,
    loopEach: whole(s.forkLettersLoopEach, 2, 100, 6),
    fromPaired: s.forkLettersFromPaired !== false,
    board: s.forkBoard !== false,
    maxOpenPerChat: whole(s.forkBoardMaxOpenPerChat, 1, 100, 10)
  }
}

export const FORK_LETTER_MAX_CHARS = 8000
export const FORK_BOARD_TITLE_MAX_CHARS = 200
export const FORK_BOARD_BODY_MAX_CHARS = 4000
export const FORK_BOARD_NOTE_MAX_CHARS = 4000
/** A queued letter not delivered in this time expires. */
export const FORK_LETTER_EXPIRE_MS = 24 * 60 * 60_000
/** Settled letters and closed asks are kept this long for the history view. */
export const FORK_LETTER_KEEP_MS = 7 * 24 * 60 * 60_000
export const FORK_LETTER_KEEP_MAX = 500
export const FORK_BOARD_KEEP_MAX = 300
/** Letters one recipient may hold undelivered. */
export const FORK_LETTER_QUEUE_PER_CHAT = 20
/** A chat id as hosts exchange and print it: session ids and pane keys, never spaces or quotes. */
export const FORK_LETTER_CHAT_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,511}$/

/** Where a party lives, seen from the host that keeps the record. null is this host. */
export type ForkLetterHost =
  /** A paired server this host reaches (the desktop's side). */
  | { kind: 'environment'; id: string; name: string }
  /** A paired device that reached this host (the server's side); its claims are unverified. */
  | { kind: 'device'; id: string; name: string }

export type ForkLetterPartyKind = 'chat' | 'terminal' | 'shell'

export type ForkLetterParty = {
  /** A native chat session id, a terminal agent pane key, or 'shell' for a command run outside any agent. */
  chatId: string
  kind: ForkLetterPartyKind
  title: string
  agent: string
  worktreeId: string | null
  host: ForkLetterHost | null
}

/**
 * - queued: waits for the recipient on this host to rest between turns.
 * - delivered: typed into the recipient.
 * - forwarded: handed to the paired host the recipient lives on.
 * - pickup: waits for the paired device the recipient lives on to collect it.
 * - expired: not delivered in a day. failed: the paired host refused it.
 */
export type ForkLetterState = 'queued' | 'delivered' | 'forwarded' | 'pickup' | 'expired' | 'failed'

export type ForkLetter = {
  id: string
  from: ForkLetterParty
  to: ForkLetterParty
  text: string
  /** The id of an earlier letter between the two that this one answers. */
  cite: string | null
  at: number
  state: ForkLetterState
  settledAt: number | null
  /** Why it failed or expired, or what held its last delivery try. */
  note: string | null
  tries: number
  /** Set on the host's own message that an ask was thrown back: `text` is typed in as it is. */
  boardBack?: true
}

export type ForkBoardAskType = 'REVIEW' | 'DECIDE' | 'DO'
export const FORK_BOARD_ASK_TYPES: readonly ForkBoardAskType[] = ['REVIEW', 'DECIDE', 'DO']

export type ForkBoardAsk = {
  id: string
  type: ForkBoardAskType
  title: string
  body: string
  from: ForkLetterParty
  at: number
  state: 'open' | 'done' | 'thrown'
  closedAt: number | null
  /** 'user': from the app or a command run outside any agent; 'author': the agent that filed it. */
  closedBy: 'user' | 'author' | null
  /** The user's note when thrown back, or the author's when done. */
  note: string | null
}

/** One letter or ask counted against its sender's rate. Keys are `letterPartyKey`. */
export type ForkLetterSent = { at: number; from: string; to: string }

export function forkLetterHostKey(host: ForkLetterHost | null): string {
  return host ? `${host.kind}:${host.id}` : 'local'
}

export function letterPartyKey(party: Pick<ForkLetterParty, 'chatId' | 'host'>): string {
  return `${forkLetterHostKey(party.host)}|${party.chatId}`
}

/** True when the two name the same chat on the same host. */
export function sameLetterParty(
  a: Pick<ForkLetterParty, 'chatId' | 'host'>,
  b: Pick<ForkLetterParty, 'chatId' | 'host'>
): boolean {
  return letterPartyKey(a) === letterPartyKey(b)
}

/**
 * Why the rate limit refuses this letter, or undefined. The sender has sent `maxPerWindow` in
 * the window, or the two have written each other `loopEach` times each way (a loop). One-way
 * fan-out short of the cap is never a loop. Board asks pass `to` as null: only the cap applies.
 */
export function forkLetterRateRefusal(
  sent: readonly ForkLetterSent[],
  from: string,
  to: string | null,
  config: Pick<ForkLettersConfig, 'maxPerWindow' | 'windowMs' | 'loopEach'>,
  now: number
): string | undefined {
  const recent = sent.filter((entry) => now - entry.at < config.windowMs)
  const minutes = Math.round(config.windowMs / 60_000)
  const mine = recent.filter((entry) => entry.from === from).length
  if (mine >= config.maxPerWindow) {
    return `this chat sent ${mine} letters or asks in the last ${minutes} minutes (at most ${config.maxPerWindow}); wait and send again`
  }
  if (to === null || to === from) {
    return undefined
  }
  const there = recent.filter((entry) => entry.from === from && entry.to === to).length + 1
  const back = recent.filter((entry) => entry.from === to && entry.to === from).length
  if (Math.min(there, back) >= config.loopEach) {
    return `the two chats wrote each other ${there + back} times in the last ${minutes} minutes, which reads as a loop; wait and send again`
  }
  return undefined
}

/** The sent log with entries older than the window dropped. */
export function pruneForkLetterSent(
  sent: readonly ForkLetterSent[],
  windowMs: number,
  now: number
): ForkLetterSent[] {
  return sent.filter((entry) => now - entry.at < windowMs).slice(-2000)
}

/** The one item an id or unique prefix (4+ characters) names, else an error. */
export function findForkLetterItem<T extends { id: string }>(
  items: readonly T[],
  query: string,
  noun: string
): { ok: true; item: T } | { ok: false; error: string } {
  const exact = items.find((item) => item.id === query)
  if (exact) {
    return { ok: true, item: exact }
  }
  const matches = query.length >= 4 ? items.filter((item) => item.id.startsWith(query)) : []
  if (matches.length === 1) {
    return { ok: true, item: matches[0] }
  }
  return {
    ok: false,
    error:
      matches.length === 0
        ? `No ${noun} matches "${query}".`
        : `"${query}" matches ${matches.length} ${noun}s; type more of the id.`
  }
}

/** Letters kept: every queued or pickup one, settled ones for a week, at most the cap. */
export function pruneForkLetters(letters: readonly ForkLetter[], now: number): ForkLetter[] {
  const kept = letters.filter(
    (letter) => letter.settledAt === null || now - letter.settledAt < FORK_LETTER_KEEP_MS
  )
  return kept.slice(-FORK_LETTER_KEEP_MAX)
}

/** Asks kept: every open one, closed ones for a week, at most the cap. */
export function pruneForkBoardAsks(asks: readonly ForkBoardAsk[], now: number): ForkBoardAsk[] {
  const kept = asks.filter(
    (ask) => ask.closedAt === null || now - ask.closedAt < FORK_LETTER_KEEP_MS
  )
  return kept.slice(-FORK_BOARD_KEEP_MAX)
}

/** A letter is the chat's when it sent or got it. */
export function forkLetterInvolves(letter: ForkLetter, chatId: string): boolean {
  return letter.from.chatId === chatId || letter.to.chatId === chatId
}
