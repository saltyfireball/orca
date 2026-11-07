// SLRM-1394: how far this app instance got with a provider's output, so the next instance can ask
// its broker for exactly the rest. Counts the stdout bytes handed to the app's reader, the end of
// the last whole line among them, and the provider's control requests the app has not answered
// yet (a permission prompt waiting on the user), which the next instance must see again.

/** How much of each stdout line is kept to recognise a control request; its id comes first. */
const LINE_HEAD_BYTES = 64 * 1024
/** How much of each stdin line is kept to recognise a control response. */
const INPUT_HEAD_BYTES = 4 * 1024

const REQUEST_ID = /"request_id"\s*:\s*"([^"\\]{1,256})"/
const CONTROL_REQUEST = /^\s*\{\s*"type"\s*:\s*"control_request"/
const CONTROL_CANCEL = /^\s*\{\s*"type"\s*:\s*"control_cancel_request"/
const CONTROL_RESPONSE = /^\s*\{\s*"type"\s*:\s*"control_response"/

export type ChatSurviveStreamMark = {
  /** Replay stdout from here: the last whole line, or the earliest unanswered request before it. */
  out: number
  err: number
  /** Stdout the app already handled up to here, apart from the `pending` requests. */
  seen: number
  /** Unanswered provider control requests, by request id. */
  pending: string[]
}

export type ChatSurviveStreamTracker = {
  stdout: (chunk: Buffer | string) => void
  stderr: (chunk: Buffer | string) => void
  stdin: (chunk: Buffer | string) => void
  mark: () => ChatSurviveStreamMark
}

function bytes(chunk: Buffer | string): Buffer {
  return typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
}

/** Splits a byte stream into line heads; `onLine` gets each head with its line's start offset. */
function lineHeads(
  cap: number,
  onLine: (head: string, start: number) => void
): { push: (data: Buffer) => void; delivered: () => number; lineEnd: () => number } {
  let delivered = 0
  let lineStart = 0
  let head = ''
  const keep = (part: Buffer): void => {
    const room = cap - head.length
    if (room > 0) {
      head += part.subarray(0, room).toString('latin1')
    }
  }
  return {
    push(data) {
      let from = 0
      for (let newline = data.indexOf(0x0a); newline !== -1; newline = data.indexOf(0x0a, from)) {
        keep(data.subarray(from, newline))
        onLine(head, lineStart)
        head = ''
        lineStart = delivered + newline + 1
        from = newline + 1
      }
      keep(data.subarray(from))
      delivered += data.length
    },
    delivered: () => delivered,
    lineEnd: () => lineStart
  }
}

export function createChatSurviveStreamTracker(): ChatSurviveStreamTracker {
  const pending = new Map<string, number>()
  let err = 0
  const out = lineHeads(LINE_HEAD_BYTES, (head, start) => {
    const id = REQUEST_ID.exec(head)?.[1]
    if (!id) {
      return
    }
    if (CONTROL_REQUEST.test(head)) {
      pending.set(id, start)
    } else if (CONTROL_CANCEL.test(head)) {
      pending.delete(id)
    }
  })
  const input = lineHeads(INPUT_HEAD_BYTES, (head) => {
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
    mark: () => {
      const seen = out.lineEnd()
      return {
        out: Math.min(seen, ...pending.values()),
        err,
        seen,
        pending: [...pending.keys()]
      }
    }
  }
}
