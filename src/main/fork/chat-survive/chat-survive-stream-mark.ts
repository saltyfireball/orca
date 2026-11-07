// SLRM-1394: how far this app instance got with a provider's output, so the next instance can ask
// its broker for exactly the rest. Two points matter. `delivered` is the end of the last whole
// line handed to the app's reader (the SDK): control requests up to there have been dispatched.
// `seen` is the end of the last line whose message the app consumed (handed to the chat's journal,
// matched by its uuid): the SDK queues messages it has read, and those must come again. Plus the
// provider's control requests the app has not answered yet (a permission prompt waiting on the
// user), which the next instance must see again.

/** How much of each stdout line is kept to recognise a control request; its id comes first. */
const LINE_HEAD_BYTES = 64 * 1024
/** How much of each stdout line's end is kept to find its uuid, which Claude Code writes late. */
const LINE_TAIL_BYTES = 1024
/** How much of each stdin line is kept to recognise a control response. */
const INPUT_HEAD_BYTES = 4 * 1024
/** Lines read but not yet consumed that are kept; the SDK consumes in order, so few wait. */
const MAX_WAITING_LINES = 10_000

export const REQUEST_ID = /"request_id"\s*:\s*"([^"\\]{1,256})"/
export const CONTROL_REQUEST = /^\s*\{\s*"type"\s*:\s*"control_request"/
/** Any control frame: request, response, cancel or keep-alive. Never a chat message. */
export const CONTROL_LINE = /^\s*\{\s*"type"\s*:\s*"(?:control_\w+|keep_alive)"/
const CONTROL_CANCEL = /^\s*\{\s*"type"\s*:\s*"control_cancel_request"/
const CONTROL_RESPONSE = /^\s*\{\s*"type"\s*:\s*"control_response"/
const UUID = /"uuid"\s*:\s*"([0-9a-fA-F-]{8,64})"/g

export type ChatSurviveStreamMark = {
  /** Replay stdout from here: the earliest of `seen` and the unanswered requests. */
  out: number
  err: number
  /** Messages up to here were consumed; below it only the `pending` requests come again. */
  seen: number
  /** Control requests up to here were dispatched; between `seen` and here only messages replay. */
  delivered: number
  /** Unanswered provider control requests, by request id. */
  pending: string[]
}

export type ChatSurviveStreamTracker = {
  stdout: (chunk: Buffer | string) => void
  stderr: (chunk: Buffer | string) => void
  stdin: (chunk: Buffer | string) => void
  /** The app consumed the message with this uuid. */
  consumed: (uuid: string) => void
  mark: () => ChatSurviveStreamMark
}

function bytes(chunk: Buffer | string): Buffer {
  return typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
}

type Line = { head: string; tail: string; start: number; end: number }

/** Splits a byte stream into lines; `onLine` gets each one's head, tail and offsets. */
function lineHeads(
  cap: number,
  onLine: (line: Line) => void,
  base = 0
): { push: (data: Buffer) => void; lineEnd: () => number } {
  let delivered = base
  let lineStart = base
  let head = ''
  let tail = Buffer.alloc(0)
  const keep = (part: Buffer): void => {
    const room = cap - head.length
    if (room > 0) {
      head += part.subarray(0, room).toString('latin1')
    }
    tail = Buffer.concat([tail, part.subarray(-LINE_TAIL_BYTES)]).subarray(-LINE_TAIL_BYTES)
  }
  return {
    push(data) {
      let from = 0
      for (let newline = data.indexOf(0x0a); newline !== -1; newline = data.indexOf(0x0a, from)) {
        keep(data.subarray(from, newline))
        const end = delivered + newline + 1
        onLine({ head, tail: tail.toString('latin1'), start: lineStart, end })
        head = ''
        tail = Buffer.alloc(0)
        lineStart = end
        from = newline + 1
      }
      keep(data.subarray(from))
      delivered += data.length
    },
    lineEnd: () => lineStart
  }
}

/** The uuids a line names near its start or end; the message's own is among them. */
export function lineUuids(head: string, tail: string): string[] {
  return [...`${head}\n${tail}`.matchAll(UUID)].map((match) => match[1] ?? '')
}

/**
 * `from` continues a mark an earlier app instance saved: offsets count from the broker's first
 * byte. Of the replayed lines it had already dispatched only its unanswered requests count again,
 * and the messages it had consumed never reach this instance.
 */
export function createChatSurviveStreamTracker(
  from?: ChatSurviveStreamMark
): ChatSurviveStreamTracker {
  const dispatched = from?.delivered ?? 0
  const stillPending = new Set(from?.pending)
  // Until its line comes round again, a carried-over request holds the replay at the old mark.
  const pending = new Map<string, number>([...stillPending].map((id) => [id, from?.out ?? 0]))
  let seen = from?.seen ?? 0
  let waiting: { uuids: string[]; end: number }[] = []
  let err = from?.err ?? 0
  const out = lineHeads(
    LINE_HEAD_BYTES,
    ({ head, tail, start, end }) => {
      if (CONTROL_LINE.test(head)) {
        const id = REQUEST_ID.exec(head)?.[1]
        if (!id || (start < dispatched && !stillPending.has(id))) {
          return
        }
        if (CONTROL_REQUEST.test(head)) {
          pending.set(id, start)
        } else if (CONTROL_CANCEL.test(head)) {
          pending.delete(id)
        }
      } else if (start >= seen && waiting.length < MAX_WAITING_LINES) {
        waiting.push({ uuids: lineUuids(head, tail), end })
      }
    },
    from?.out ?? 0
  )
  const input = lineHeads(INPUT_HEAD_BYTES, ({ head }) => {
    const id = CONTROL_RESPONSE.test(head) ? REQUEST_ID.exec(head)?.[1] : undefined
    if (id) {
      pending.delete(id)
    }
  })
  return {
    stdout: (chunk) => out.push(bytes(chunk)),
    stderr: (chunk) => {
      err += bytes(chunk).length
    },
    stdin: (chunk) => input.push(bytes(chunk)),
    consumed: (uuid) => {
      // In order: lines before the consumed one are messages the SDK does not yield.
      const index = waiting.findIndex((line) => line.uuids.includes(uuid))
      if (index !== -1) {
        seen = Math.max(seen, waiting[index]?.end ?? seen)
        waiting = waiting.slice(index + 1)
      }
    },
    mark: () => {
      const delivered = Math.max(out.lineEnd(), dispatched, seen)
      return {
        out: Math.min(seen, ...pending.values()),
        err,
        seen,
        delivered,
        pending: [...pending.keys()]
      }
    }
  }
}
