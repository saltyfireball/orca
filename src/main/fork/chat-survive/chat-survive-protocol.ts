// SLRM-1394: the wire between a chat-survive broker and the app instance that owns it now.
// One JSON object per line over a Unix socket. Bytes travel base64 so the framing never depends
// on what a provider writes. Every object carries `t`; the hello and the welcome carry `v`.
import { timingSafeEqual } from 'node:crypto'

/** Bump on any change an older broker or client would misread. A mismatch is refused, never guessed. */
export const CHAT_SURVIVE_PROTOCOL_VERSION = 1

/** Longest hello a broker reads before it drops the connection. */
export const CHAT_SURVIVE_MAX_HELLO_BYTES = 4096

export type ChatSurviveStream = 'out' | 'err'

export type ChatSurviveExit = { code: number | null; signal: NodeJS.Signals | null }

export type ChatSurviveHello = {
  t: 'hello'
  v: number
  token: string
  /** The owner's lease fence. A higher fence takes the broker over; a lower one is refused. */
  fence: number
  /** Offsets the client already holds; the broker replays from there. */
  from: { out: number; err: number }
}

/** `busy`: the app instance that started the broker is still alive and owns it over stdio. */
export type ChatSurviveRefusalReason =
  | 'bad-token'
  | 'version'
  | 'stale-fence'
  | 'malformed'
  | 'busy'

export type ChatSurviveBrokerFrame =
  | {
      t: 'welcome'
      v: number
      pid: number
      fence: number
      out: { first: number; end: number; truncated: boolean }
      err: { first: number; end: number; truncated: boolean }
      exit: ChatSurviveExit | null
    }
  | { t: 'refused'; v: number; reason: ChatSurviveRefusalReason }
  | { t: 'data'; s: ChatSurviveStream; o: number; d: string }
  | { t: 'exit'; code: number | null; signal: NodeJS.Signals | null }
  /** A client with a higher fence took over; this connection closes next. */
  | { t: 'superseded'; fence: number }

export type ChatSurviveClientFrame =
  | ChatSurviveHello
  | { t: 'in'; d: string }
  /** Ends the provider's stdin, which a session provider takes as a close request. */
  | { t: 'end' }
  /** Stop the provider group now (SIGTERM, then SIGKILL after the grace). */
  | { t: 'stop' }
  /** The owner has what it needs (normally after `exit`); the broker may go. */
  | { t: 'release' }

export function encodeFrame(frame: ChatSurviveBrokerFrame | ChatSurviveClientFrame): string {
  return `${JSON.stringify(frame)}\n`
}

/** Splits a byte stream into parsed JSON lines; a line that is not an object comes back as null. */
export function createLineDecoder(onFrame: (frame: Record<string, unknown> | null) => void): {
  push: (chunk: Buffer) => void
  /** Bytes held while waiting for a newline. */
  pending: () => number
} {
  let buffered = ''
  return {
    push(chunk) {
      buffered += chunk.toString('utf8')
      let newline = buffered.indexOf('\n')
      while (newline !== -1) {
        const line = buffered.slice(0, newline)
        buffered = buffered.slice(newline + 1)
        onFrame(parseObject(line))
        newline = buffered.indexOf('\n')
      }
    },
    pending: () => Buffer.byteLength(buffered)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseObject(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function isOffset(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** The hello's shape, or null. Version and token are judged by the broker, not here. */
export function parseHello(frame: Record<string, unknown> | null): ChatSurviveHello | null {
  if (!frame || frame.t !== 'hello' || typeof frame.v !== 'number') {
    return null
  }
  const from = frame.from
  if (
    typeof frame.token !== 'string' ||
    !isOffset(frame.fence) ||
    !isRecord(from) ||
    !isOffset(from.out) ||
    !isOffset(from.err)
  ) {
    return null
  }
  return {
    t: 'hello',
    v: frame.v,
    token: frame.token,
    fence: frame.fence,
    from: { out: from.out, err: from.err }
  }
}

/** Constant-time token check, so a local caller cannot time its way to the token. */
export function tokensMatch(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(given, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

const REFUSAL_REASONS: readonly ChatSurviveRefusalReason[] = [
  'bad-token',
  'version',
  'stale-fence',
  'malformed',
  'busy'
]

function isSignal(value: unknown): value is NodeJS.Signals | null {
  return value === null || (typeof value === 'string' && value.startsWith('SIG'))
}

function isExitCode(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value))
}

function parseExit(value: unknown): ChatSurviveExit | null | undefined {
  if (value === null) {
    return null
  }
  return isRecord(value) && isExitCode(value.code) && isSignal(value.signal)
    ? { code: value.code, signal: value.signal }
    : undefined
}

function parseRange(value: unknown): { first: number; end: number; truncated: boolean } | null {
  return isRecord(value) &&
    isOffset(value.first) &&
    isOffset(value.end) &&
    typeof value.truncated === 'boolean'
    ? { first: value.first, end: value.end, truncated: value.truncated }
    : null
}

/** A broker frame of a known kind and shape, or null; a client drops anything else. */
export function parseBrokerFrame(
  frame: Record<string, unknown> | null
): ChatSurviveBrokerFrame | null {
  if (!frame) {
    return null
  }
  switch (frame.t) {
    case 'welcome': {
      const out = parseRange(frame.out)
      const err = parseRange(frame.err)
      const exit = parseExit(frame.exit)
      if (
        typeof frame.v !== 'number' ||
        !isOffset(frame.pid) ||
        !isOffset(frame.fence) ||
        !out ||
        !err ||
        exit === undefined
      ) {
        return null
      }
      return { t: 'welcome', v: frame.v, pid: frame.pid, fence: frame.fence, out, err, exit }
    }
    case 'refused': {
      const reason = REFUSAL_REASONS.find((known) => known === frame.reason)
      return typeof frame.v === 'number' && reason ? { t: 'refused', v: frame.v, reason } : null
    }
    case 'data':
      return (frame.s === 'out' || frame.s === 'err') &&
        isOffset(frame.o) &&
        typeof frame.d === 'string'
        ? { t: 'data', s: frame.s, o: frame.o, d: frame.d }
        : null
    case 'exit':
      return isExitCode(frame.code) && isSignal(frame.signal)
        ? { t: 'exit', code: frame.code, signal: frame.signal }
        : null
    case 'superseded':
      return isOffset(frame.fence) ? { t: 'superseded', fence: frame.fence } : null
    default:
      return null
  }
}
