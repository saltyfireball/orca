// SLRM-1394: a provider adopted from an earlier app instance, shaped as the child process the
// Claude spawn hook returns. Its pid is the broker's, so the lease, the exit proof and every signal
// still name the real process group; its stdio is the broker's socket. Output replays from the
// saved mark: of the lines the earlier instance had already consumed only its unanswered control
// requests come again (a permission prompt still waiting on the user), then everything after.
import { EventEmitter } from 'node:events'
import { Transform, Writable, type TransformCallback } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ChatSurviveConnection } from './chat-survive-client'
import { isRecord, type ChatSurviveExit } from './chat-survive-protocol'
import {
  CONTROL_LINE,
  CONTROL_REQUEST,
  REQUEST_ID,
  type ChatSurviveStreamMark,
  type ChatSurviveStreamTracker
} from './chat-survive-stream-mark'

/** How often an adopted child checks that its broker has gone after the provider exited. */
const EXIT_POLL_MS = 100

/**
 * Replays from `mark.out`: below `mark.seen` only the still-pending control requests, up to
 * `mark.delivered` also the messages the earlier instance read but never consumed, and from there
 * on everything. Control frames the earlier instance dispatched never come again.
 */
export function chatSurviveReplayFilter(mark: ChatSurviveStreamMark): Transform {
  const pending = new Set(mark.pending)
  let offset = mark.out
  let partial = Buffer.alloc(0)
  const keeps = (line: Buffer): boolean => {
    const head = line.subarray(0, 64 * 1024).toString('latin1')
    const id = CONTROL_REQUEST.test(head) ? REQUEST_ID.exec(head)?.[1] : undefined
    if (id !== undefined && pending.has(id)) {
      return true
    }
    return offset >= mark.seen && !CONTROL_LINE.test(head)
  }
  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      if (offset >= mark.delivered && partial.length === 0) {
        offset += chunk.length
        callback(null, chunk)
        return
      }
      let data = Buffer.concat([partial, chunk])
      for (let newline = data.indexOf(0x0a); newline !== -1; newline = data.indexOf(0x0a)) {
        const line = data.subarray(0, newline + 1)
        data = data.subarray(newline + 1)
        if (keeps(line)) {
          this.push(line)
        }
        offset += line.length
        if (offset >= mark.delivered) {
          break
        }
      }
      partial = offset >= mark.delivered ? Buffer.alloc(0) : data
      if (offset >= mark.delivered && data.length > 0) {
        offset += data.length
        this.push(data)
      }
      callback()
    }
  })
}

const CONTROL_RESPONSE = /^\s*\{\s*"type"\s*:\s*"control_response"/
const REDELIVERED = ['pending_permission_requests', 'pending_user_dialog_requests']

function parsed(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function withoutReplayed(line: string, replayed: ReadonlySet<string>): string {
  const frame = parsed(line)
  const response = isRecord(frame) ? frame.response : null
  if (!isRecord(response)) {
    return line
  }
  for (const key of REDELIVERED) {
    const listed = response[key]
    if (Array.isArray(listed)) {
      response[key] = listed.filter((request: unknown) => {
        const id = isRecord(request) ? request.request_id : null
        return typeof id !== 'string' || !replayed.has(id)
      })
    }
  }
  return `${JSON.stringify(frame)}\n`
}

/**
 * Claude Code 2.1.268+ also lists its unanswered prompts in the reply to the new instance's
 * `initialize`, and the SDK only folds a second delivery into one still in flight: a prompt
 * answered quickly would be asked twice. Drops from that reply the requests the replay carries.
 */
export function chatSurviveRedeliveryFilter(replayed: readonly string[]): Transform {
  const ids = new Set(replayed)
  let done = ids.size === 0
  let partial = Buffer.alloc(0)
  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      if (done) {
        callback(null, chunk)
        return
      }
      let data = Buffer.concat([partial, chunk])
      for (
        let newline = data.indexOf(0x0a);
        !done && newline !== -1;
        newline = data.indexOf(0x0a)
      ) {
        const line = data.subarray(0, newline + 1).toString('utf8')
        data = data.subarray(newline + 1)
        done = CONTROL_RESPONSE.test(line) && line.includes('"pending_')
        this.push(done ? withoutReplayed(line, ids) : line)
      }
      partial = done ? Buffer.alloc(0) : data
      callback(null, done && data.length > 0 ? data : undefined)
    },
    flush(callback: TransformCallback) {
      callback(null, partial.length > 0 ? partial : undefined)
    }
  })
}

/** The fields the managed provider process and the Claude SDK use of a piped child. */
function isPiped(child: unknown): child is ChildProcessWithoutNullStreams {
  return (
    child instanceof EventEmitter &&
    'stdin' in child &&
    child.stdin instanceof EventEmitter &&
    'stdout' in child &&
    child.stdout instanceof EventEmitter &&
    'stderr' in child &&
    child.stderr instanceof EventEmitter &&
    'pid' in child &&
    typeof child.pid === 'number' &&
    'kill' in child &&
    typeof child.kill === 'function'
  )
}

function gone(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ESRCH'
  }
}

/**
 * Reports the exit once the provider's exit is known and the broker process itself is gone.
 * Returns whether that happened: from then on the pid may name some other process.
 */
function reportExit(
  child: EventEmitter,
  pid: number,
  connection: ChatSurviveConnection
): () => boolean {
  let exit: ChatSurviveExit = { code: null, signal: null }
  let watching = false
  let over = false
  const finish = (): void => {
    over = true
    Object.defineProperty(child, 'exitCode', { value: exit.code, configurable: true })
    Object.defineProperty(child, 'signalCode', { value: exit.signal, configurable: true })
    child.emit('exit', exit.code, exit.signal)
    // The broker is gone, so its socket has closed or is closing; stdio ends with it.
    void connection.ended.then(() => child.emit('close', exit.code, exit.signal))
  }
  const watch = (): void => {
    if (watching) {
      return
    }
    watching = true
    const timer = setInterval(() => {
      if (gone(pid)) {
        clearInterval(timer)
        finish()
      }
    }, EXIT_POLL_MS)
    timer.unref()
  }
  void connection.exited.then((reported) => {
    exit = reported
    // The provider's exit is all this side needs; the broker may go.
    connection.release()
    watch()
  })
  // A connection lost without an exit (a crashed broker) still ends once the broker is gone.
  void connection.ended.then(watch)
  return () => over
}

export function chatSurviveAdoptedChild(input: {
  connection: ChatSurviveConnection
  brokerPid: number
  mark: ChatSurviveStreamMark
  tracker: ChatSurviveStreamTracker
}): ChildProcessWithoutNullStreams {
  const { connection, brokerPid, tracker } = input
  // Shaped like a spawned child; node:child_process stays behind @orca/process-host.
  const child = new EventEmitter()
  const stdout = chatSurviveRedeliveryFilter(input.mark.pending)
  connection.stdout.on('data', (chunk: Buffer) => tracker.stdout(chunk))
  connection.stdout.pipe(chatSurviveReplayFilter(input.mark)).pipe(stdout)
  connection.stderr.on('data', (chunk: Buffer) => tracker.stderr(chunk))
  const stdin = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      connection.write(chunk, () => callback())
    },
    final(callback) {
      // A session provider takes the end of its input as a close request, as over a pipe.
      connection.endInput()
      callback()
    }
  })
  const define = (name: string, value: unknown): void => {
    Object.defineProperty(child, name, { value, configurable: true, writable: true })
  }
  define('stdin', stdin)
  define('stdout', stdout)
  define('stderr', connection.stderr)
  define('stdio', [stdin, stdout, connection.stderr])
  define('pid', brokerPid)
  define('connected', false)
  define('killed', false)
  define('exitCode', null)
  define('signalCode', null)
  define('spawnfile', process.execPath)
  define('spawnargs', [])
  for (const name of ['ref', 'unref', 'disconnect']) {
    define(name, () => {})
  }
  // Signals go to the broker itself, the process the earlier instance spawned in this place, and
  // never once it is gone: its pid may be reused by then.
  const brokerGone = reportExit(child, brokerPid, connection)
  define('kill', (signal?: NodeJS.Signals | number): boolean => {
    if (brokerGone()) {
      return false
    }
    try {
      process.kill(brokerPid, signal ?? 'SIGTERM')
      return true
    } catch {
      return false
    }
  })
  if (!isPiped(child)) {
    throw new Error('adopted chat-survive child has no stdio')
  }
  queueMicrotask(() => child.emit('spawn'))
  return child
}
