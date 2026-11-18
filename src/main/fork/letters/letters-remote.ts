// Letters and the board (FORK.md, SLRM-2389): what a paired server says about its own asks and
// letters, rebuilt field by field before the window shows it. A server is paired, but its answer
// is still data from another machine: wrong types, long strings and huge lists are dropped or cut.
import {
  FORK_BOARD_BODY_MAX_CHARS,
  FORK_BOARD_KEEP_MAX,
  FORK_BOARD_NOTE_MAX_CHARS,
  FORK_BOARD_TITLE_MAX_CHARS,
  FORK_LETTER_KEEP_MAX,
  FORK_LETTER_MAX_CHARS,
  type ForkBoardAsk,
  type ForkLetter,
  type ForkLetterHost,
  type ForkLetterParty,
  type ForkLetterState
} from '../../../shared/fork/letters'

type Raw = Record<string, unknown>

const obj = (value: unknown): Raw =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {}
const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.slice(0, max) : ''
const time = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback

const LETTER_STATES: readonly ForkLetterState[] = [
  'queued',
  'delivered',
  'forwarded',
  'pickup',
  'expired',
  'failed'
]

function remoteHost(raw: unknown): ForkLetterHost | null {
  const host = obj(raw)
  if (host.kind !== 'environment' && host.kind !== 'device') {
    return null
  }
  return { kind: host.kind, id: text(host.id, 200), name: text(host.name, 200) }
}

function remoteParty(raw: unknown): ForkLetterParty {
  const party = obj(raw)
  return {
    chatId: text(party.chatId, 512),
    kind: oneOf(party.kind, ['chat', 'terminal', 'shell'] as const, 'chat'),
    title: text(party.title, 200),
    agent: text(party.agent, 100),
    worktreeId: typeof party.worktreeId === 'string' ? party.worktreeId.slice(0, 512) : null,
    host: remoteHost(party.host)
  }
}

/** One open ask a server listed, or null when it is not one. */
export function remoteForkBoardAsk(raw: unknown): ForkBoardAsk | null {
  const ask = obj(raw)
  const id = text(ask.id, 64)
  const at = time(ask.at)
  if (!id || at === null || ask.state !== 'open') {
    return null
  }
  return {
    id,
    type: oneOf(ask.type, ['REVIEW', 'DECIDE', 'DO'] as const, 'DO'),
    title: text(ask.title, FORK_BOARD_TITLE_MAX_CHARS),
    body: text(ask.body, FORK_BOARD_BODY_MAX_CHARS),
    from: remoteParty(ask.from),
    at,
    state: 'open',
    closedAt: null,
    closedBy: null,
    note: typeof ask.note === 'string' ? ask.note.slice(0, FORK_BOARD_NOTE_MAX_CHARS) : null
  }
}

/** One letter a server listed, or null when it is not one. */
export function remoteForkLetter(raw: unknown): ForkLetter | null {
  const letter = obj(raw)
  const id = text(letter.id, 64)
  const at = time(letter.at)
  if (!id || at === null || typeof letter.text !== 'string') {
    return null
  }
  return {
    id,
    from: remoteParty(letter.from),
    to: remoteParty(letter.to),
    text: letter.text.slice(0, FORK_LETTER_MAX_CHARS),
    cite: typeof letter.cite === 'string' ? letter.cite.slice(0, 12) : null,
    at,
    state: oneOf(letter.state, LETTER_STATES, 'failed'),
    settledAt: time(letter.settledAt),
    note: typeof letter.note === 'string' ? letter.note.slice(0, 300) : null,
    tries: time(letter.tries) ?? 0
  }
}

/** A server's list, cut to what this host would keep of its own, each entry rebuilt. */
export function remoteForkList<T>(
  value: unknown,
  rebuild: (raw: unknown) => T | null,
  kind: 'asks' | 'letters'
): T[] {
  if (!Array.isArray(value)) {
    return []
  }
  const cap = kind === 'asks' ? FORK_BOARD_KEEP_MAX : FORK_LETTER_KEEP_MAX
  return value
    .slice(0, cap)
    .map(rebuild)
    .filter((item): item is T => item !== null)
}
