// SLRM-1394: the owner side of a chat-survive broker. It says hello with its token and fence,
// then exposes the provider as stdout and stderr streams plus input calls, the shape an adapter's
// spawn hook needs. Offsets let the next app instance ask only for what it has not seen.
import { createConnection, type Socket } from 'node:net'
import { PassThrough } from 'node:stream'
import {
  CHAT_SURVIVE_PROTOCOL_VERSION,
  createLineDecoder,
  encodeFrame,
  parseBrokerFrame,
  type ChatSurviveBrokerFrame,
  type ChatSurviveClientFrame,
  type ChatSurviveExit,
  type ChatSurviveRefusalReason,
  type ChatSurviveStream
} from './chat-survive-protocol'

export type ChatSurviveWelcome = Extract<ChatSurviveBrokerFrame, { t: 'welcome' }>

export type ChatSurviveConnectionEnd = 'superseded' | 'closed'

export type ChatSurviveConnection = {
  readonly welcome: ChatSurviveWelcome
  readonly stdout: PassThrough
  readonly stderr: PassThrough
  /** Offsets just past the last byte this connection delivered; persist them to reattach. */
  offsets: () => { out: number; err: number }
  write: (data: Buffer | string) => void
  endInput: () => void
  stop: () => void
  release: () => void
  /** Drops the connection only; the provider keeps running and the broker arms its orphan timer. */
  detach: () => void
  /** Settles when the broker reports the provider's exit. */
  readonly exited: Promise<ChatSurviveExit>
  readonly ended: Promise<ChatSurviveConnectionEnd>
}

export class ChatSurviveRefusedError extends Error {
  constructor(readonly reason: ChatSurviveRefusalReason | 'no-welcome') {
    super(`chat-survive broker refused the hello: ${reason}`)
  }
}

export type ChatSurviveConnectOptions = {
  socketPath: string
  token: string
  fence: number
  from?: { out: number; err: number }
  /** Only for the app instance that spawned the broker, moving off its stdio (the quit hook). */
  takeover?: boolean
}

export function connectChatSurviveBroker(
  options: ChatSurviveConnectOptions
): Promise<ChatSurviveConnection> {
  const socket: Socket = createConnection(options.socketPath)
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const streams: Record<ChatSurviveStream, PassThrough> = { out: stdout, err: stderr }
  const held = { ...(options.from ?? { out: 0, err: 0 }) }
  const exited = Promise.withResolvers<ChatSurviveExit>()
  const ended = Promise.withResolvers<ChatSurviveConnectionEnd>()
  const opened = Promise.withResolvers<ChatSurviveConnection>()
  let welcome: ChatSurviveWelcome | null = null
  let superseded = false

  const send = (frame: ChatSurviveClientFrame): void => {
    if (!socket.destroyed) {
      socket.write(encodeFrame(frame))
    }
  }

  const deliver = (stream: ChatSurviveStream, offset: number, data: Buffer): void => {
    // A replay can overlap what this side already holds; keep only the new tail.
    const skip = Math.max(0, held[stream] - offset)
    if (skip >= data.length) {
      return
    }
    streams[stream].write(skip > 0 ? data.subarray(skip) : data)
    held[stream] = offset + data.length
  }

  const decoder = createLineDecoder((raw) => {
    const frame = parseBrokerFrame(raw)
    if (!frame) {
      return
    }
    if (!welcome) {
      if (frame.t === 'welcome') {
        welcome = frame
        opened.resolve(connection(frame))
      } else if (frame.t === 'refused') {
        opened.reject(new ChatSurviveRefusedError(frame.reason))
      }
      return
    }
    if (frame.t === 'data') {
      deliver(frame.s, frame.o, Buffer.from(frame.d, 'base64'))
    } else if (frame.t === 'exit') {
      exited.resolve({ code: frame.code, signal: frame.signal })
    } else if (frame.t === 'superseded') {
      superseded = true
    }
  })

  socket.on('connect', () => {
    send({
      t: 'hello',
      v: CHAT_SURVIVE_PROTOCOL_VERSION,
      token: options.token,
      fence: options.fence,
      from: { ...held },
      ...(options.takeover === true ? { takeover: true } : {})
    })
  })
  socket.on('data', (chunk: Buffer) => decoder.push(chunk))
  socket.on('error', (error) => opened.reject(error))
  socket.on('close', () => {
    opened.reject(new ChatSurviveRefusedError('no-welcome'))
    stdout.end()
    stderr.end()
    ended.resolve(superseded ? 'superseded' : 'closed')
  })
  // Rejections after the welcome are not interesting to anyone.
  opened.promise.catch(() => {})

  function connection(frame: ChatSurviveWelcome): ChatSurviveConnection {
    return {
      welcome: frame,
      stdout,
      stderr,
      offsets: () => ({ ...held }),
      write: (data) => send({ t: 'in', d: Buffer.from(data).toString('base64') }),
      endInput: () => send({ t: 'end' }),
      stop: () => send({ t: 'stop' }),
      release: () => send({ t: 'release' }),
      detach: () => socket.destroy(),
      exited: exited.promise,
      ended: ended.promise
    }
  }

  return opened.promise
}
