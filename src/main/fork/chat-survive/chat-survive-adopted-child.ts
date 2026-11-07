// SLRM-1394: a provider adopted from an earlier app instance, shaped as the child process the
// Claude spawn hook returns. Its pid is the broker's, so the lease, the exit proof and every signal
// still name the real process group; its stdio is the broker's socket. Output replays from the
// saved mark: of the lines the earlier instance had already handled only its unanswered control
// requests come again (a permission prompt still waiting on the user), then everything after.
import { EventEmitter } from 'node:events'
import { Transform, Writable, type TransformCallback } from 'node:stream'
import type { PipedChildProcess } from '@orca/process-host/process-spec'
import type { ChatSurviveConnection } from './chat-survive-client'
import type { ChatSurviveExit } from './chat-survive-protocol'
import {
  CONTROL_REQUEST,
  REQUEST_ID,
  type ChatSurviveStreamMark,
  type ChatSurviveStreamTracker
} from './chat-survive-stream-mark'

/** How often an adopted child checks that its broker has gone after the provider exited. */
const EXIT_POLL_MS = 100

/** Drops replayed lines below `mark.seen` unless they are still-pending control requests. */
export function chatSurviveReplayFilter(mark: ChatSurviveStreamMark): Transform {
  const pending = new Set(mark.pending)
  let offset = mark.out
  let partial = Buffer.alloc(0)
  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      if (offset >= mark.seen && partial.length === 0) {
        offset += chunk.length
        callback(null, chunk)
        return
      }
      let data = Buffer.concat([partial, chunk])
      for (let newline = data.indexOf(0x0a); newline !== -1; newline = data.indexOf(0x0a)) {
        const line = data.subarray(0, newline + 1)
        data = data.subarray(newline + 1)
        const head = line.subarray(0, 64 * 1024).toString('latin1')
        const id = CONTROL_REQUEST.test(head) ? REQUEST_ID.exec(head)?.[1] : undefined
        if (offset >= mark.seen || (id !== undefined && pending.has(id))) {
          this.push(line)
        }
        offset += line.length
        if (offset >= mark.seen) {
          break
        }
      }
      partial = offset >= mark.seen ? Buffer.alloc(0) : data
      if (offset >= mark.seen && data.length > 0) {
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
  const response: unknown =
    typeof frame === 'object' && frame ? Reflect.get(frame, 'response') : null
  if (typeof response !== 'object' || response === null) {
    return line
  }
  for (const key of REDELIVERED) {
    const listed: unknown = Reflect.get(response, key)
    if (Array.isArray(listed)) {
      const kept = listed.filter((request: unknown) => {
        const id =
          typeof request === 'object' && request ? Reflect.get(request, 'request_id') : null
        return typeof id !== 'string' || !replayed.has(id)
      })
      Reflect.set(response, key, kept)
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
function isPiped(child: unknown): child is PipedChildProcess {
  return (
    child instanceof EventEmitter &&
    ['stdin', 'stdout', 'stderr'].every(
      (name) => Reflect.get(child, name) instanceof EventEmitter
    ) &&
    typeof Reflect.get(child, 'pid') === 'number' &&
    typeof Reflect.get(child, 'kill') === 'function'
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

/** Reports the exit once the provider's exit is known and the broker process itself is gone. */
function reportExit(child: EventEmitter, pid: number, connection: ChatSurviveConnection): void {
  let exit: ChatSurviveExit = { code: null, signal: null }
  let watching = false
  const finish = (): void => {
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
}

export function chatSurviveAdoptedChild(input: {
  connection: ChatSurviveConnection
  brokerPid: number
  mark: ChatSurviveStreamMark
  tracker: ChatSurviveStreamTracker
}): PipedChildProcess {
  const { connection, brokerPid, tracker } = input
  // Shaped like a spawned child; node:child_process stays behind @orca/process-host.
  const child = new EventEmitter()
  const stdout = chatSurviveRedeliveryFilter(input.mark.pending)
  connection.stdout.on('data', (chunk: Buffer) => tracker.stdout(chunk))
  connection.stdout.pipe(chatSurviveReplayFilter(input.mark)).pipe(stdout)
  connection.stderr.on('data', (chunk: Buffer) => tracker.stderr(chunk))
  const stdin = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      connection.write(chunk)
      callback()
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
  // Signals go to the broker itself, the process the earlier instance spawned in this place.
  define('kill', (signal?: NodeJS.Signals | number): boolean => {
    try {
      process.kill(brokerPid, signal ?? 'SIGTERM')
      return true
    } catch {
      return false
    }
  })
  reportExit(child, brokerPid, connection)
  if (!isPiped(child)) {
    throw new Error('adopted chat-survive child has no stdio')
  }
  queueMicrotask(() => child.emit('spawn'))
  return child
}
