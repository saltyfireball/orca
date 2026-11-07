// SLRM-1394: hosts one chat provider so it can outlive the app instance that started it.
//
// The broker owns the provider's pipes. It logs stdout and stderr into bounded rings with absolute
// offsets and serves them over a Unix socket to one owner at a time. When the owner goes (its
// socket closes, as it does when the app quits or dies), the provider keeps running and the broker
// arms an orphan timer. A new owner that says hello with the token and a fence at least as high as
// the last one cancels the timer and gets everything from the offsets it already holds. With no
// owner by the deadline the broker stops the provider group and leaves.
//
// This is only the transport. Adopting a broker into a chat session (lease, journal, adapter) is
// the wiring described in docs/fork/chat-survive.md.
import { chmodSync, rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { spawnProcess } from '@orca/process-host'
import type { PipedChildProcess } from '@orca/process-host/process-spec'
import { ChatSurviveByteRing } from './chat-survive-byte-ring'
import {
  CHAT_SURVIVE_MAX_HELLO_BYTES,
  CHAT_SURVIVE_PROTOCOL_VERSION,
  createLineDecoder,
  encodeFrame,
  parseHello,
  tokensMatch,
  type ChatSurviveBrokerFrame,
  type ChatSurviveExit,
  type ChatSurviveHello,
  type ChatSurviveRefusalReason,
  type ChatSurviveStream
} from './chat-survive-protocol'

export const CHAT_SURVIVE_DEFAULT_OUT_RING_BYTES = 16 * 1024 * 1024
export const CHAT_SURVIVE_DEFAULT_ERR_RING_BYTES = 256 * 1024
export const CHAT_SURVIVE_DEFAULT_STOP_GRACE_MS = 3_000
export const CHAT_SURVIVE_HELLO_TIMEOUT_MS = 5_000
/** After the provider exits, how long its pipes get to deliver their last bytes. */
const EXIT_DRAIN_MS = 1_000

export type ChatSurviveBrokerOptions = {
  command: string
  args: readonly string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Path the broker binds. Its directory should be private to the user. */
  socketPath: string
  token: string
  /** How long the provider may run with no owner attached before the broker stops it. */
  orphanTimeoutMs: number
  outRingBytes?: number
  errRingBytes?: number
  stopGraceMs?: number
}

export type ChatSurviveBrokerEndReason = 'orphan-timeout' | 'released' | 'closed' | 'spawn-failed'

export type ChatSurviveBrokerEnd = {
  reason: ChatSurviveBrokerEndReason
  exit: ChatSurviveExit | null
}

export type ChatSurviveBrokerStatus = {
  attached: boolean
  /** True while the orphan timer runs: no owner, and the provider stops at the deadline. */
  orphaned: boolean
  fence: number
  exit: ChatSurviveExit | null
  out: number
  err: number
}

export type ChatSurviveBroker = {
  readonly pid: number
  status: () => ChatSurviveBrokerStatus
  /** Settles once the provider is gone and the socket is closed. */
  readonly done: Promise<ChatSurviveBrokerEnd>
  /** Stops the provider group and closes the broker. */
  close: () => Promise<ChatSurviveBrokerEnd>
}

type Owner = { socket: Socket; fence: number; sent: { out: number; err: number } }

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    // ESRCH: the group is already gone.
  }
}

export async function startChatSurviveBroker(
  options: ChatSurviveBrokerOptions
): Promise<ChatSurviveBroker> {
  const stopGraceMs = options.stopGraceMs ?? CHAT_SURVIVE_DEFAULT_STOP_GRACE_MS
  const rings: Record<ChatSurviveStream, ChatSurviveByteRing> = {
    out: new ChatSurviveByteRing(options.outRingBytes ?? CHAT_SURVIVE_DEFAULT_OUT_RING_BYTES),
    err: new ChatSurviveByteRing(options.errRingBytes ?? CHAT_SURVIVE_DEFAULT_ERR_RING_BYTES)
  }
  const ended = Promise.withResolvers<ChatSurviveBrokerEnd>()
  let owner: Owner | null = null
  let highestFence = 0
  let exit: ChatSurviveExit | null = null
  let orphanTimer: NodeJS.Timeout | null = null
  let killTimer: NodeJS.Timeout | null = null
  let finishing: ChatSurviveBrokerEndReason | null = null

  // Its own process group, so a stop reaches the provider's helpers and the app's death does not.
  const child: PipedChildProcess = spawnProcess({
    program: options.command,
    args: options.args,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env: options.env ?? process.env,
    stdio: 'pipe',
    detached: true
  })
  const spawned = await new Promise<boolean>((resolve) => {
    child.once('spawn', () => resolve(true))
    child.once('error', () => resolve(false))
  })
  if (!spawned || child.pid === undefined) {
    return {
      pid: -1,
      status: () => ({ attached: false, orphaned: false, fence: 0, exit: null, out: 0, err: 0 }),
      done: Promise.resolve({ reason: 'spawn-failed', exit: null }),
      close: async () => ({ reason: 'spawn-failed', exit: null })
    }
  }
  const pid = child.pid
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    stream.on('error', () => {})
  }

  const send = (target: Owner, frame: ChatSurviveBrokerFrame): void => {
    if (!target.socket.destroyed) {
      target.socket.write(encodeFrame(frame))
    }
  }

  const relay = (stream: ChatSurviveStream, data: Buffer): void => {
    const offset = rings[stream].end
    rings[stream].append(data)
    if (owner) {
      send(owner, { t: 'data', s: stream, o: offset, d: data.toString('base64') })
      owner.sent[stream] = rings[stream].end
    }
  }
  child.stdout.on('data', (data: Buffer) => relay('out', data))
  child.stderr.on('data', (data: Buffer) => relay('err', data))

  const server: Server = createServer()
  const sockets = new Set<Socket>()

  const shutdown = (reason: ChatSurviveBrokerEndReason): void => {
    if (finishing) {
      return
    }
    finishing = reason
    if (orphanTimer) {
      clearTimeout(orphanTimer)
    }
    const finish = (): void => {
      if (killTimer) {
        clearTimeout(killTimer)
      }
      for (const socket of sockets) {
        socket.destroy()
      }
      server.close(() => {
        // Our own name; nobody else binds it.
        rmSync(options.socketPath, { force: true })
        ended.resolve({ reason, exit })
      })
    }
    if (exit) {
      finish()
      return
    }
    signalGroup(pid, 'SIGTERM')
    killTimer = setTimeout(() => signalGroup(pid, 'SIGKILL'), stopGraceMs)
    exitObserved.then(finish, finish)
  }

  const armOrphanTimer = (): void => {
    if (orphanTimer || finishing) {
      return
    }
    orphanTimer = setTimeout(() => {
      orphanTimer = null
      if (!owner) {
        shutdown('orphan-timeout')
      }
    }, options.orphanTimeoutMs)
    orphanTimer.unref?.()
  }

  const exitObserved = new Promise<void>((resolve) => {
    child.once('exit', (code, signal) => {
      // Let the pipes hand over their last bytes; a helper holding them open cannot stall this.
      const drained = setTimeout(settle, EXIT_DRAIN_MS)
      child.once('close', settle)
      function settle(): void {
        clearTimeout(drained)
        if (exit) {
          return
        }
        exit = { code, signal }
        // The provider's helpers die with it.
        signalGroup(pid, 'SIGKILL')
        if (owner) {
          send(owner, { t: 'exit', code, signal })
        }
        resolve()
      }
    })
  })

  const refuse = (socket: Socket, reason: ChatSurviveRefusalReason): void => {
    socket.end(encodeFrame({ t: 'refused', v: CHAT_SURVIVE_PROTOCOL_VERSION, reason }))
  }

  const accept = (socket: Socket, hello: ChatSurviveHello): Owner => {
    const previous = owner
    const next: Owner = { socket, fence: hello.fence, sent: { out: 0, err: 0 } }
    owner = next
    highestFence = hello.fence
    if (orphanTimer) {
      clearTimeout(orphanTimer)
      orphanTimer = null
    }
    if (previous) {
      send(previous, { t: 'superseded', fence: hello.fence })
      previous.socket.end()
    }
    const out = rings.out.sliceFrom(hello.from.out)
    const err = rings.err.sliceFrom(hello.from.err)
    send(next, {
      t: 'welcome',
      v: CHAT_SURVIVE_PROTOCOL_VERSION,
      pid,
      fence: hello.fence,
      out: { first: out.first, end: out.end, truncated: out.truncated },
      err: { first: err.first, end: err.end, truncated: err.truncated },
      exit
    })
    for (const [stream, slice] of [
      ['err', err],
      ['out', out]
    ] as const) {
      if (slice.data.length > 0) {
        send(next, { t: 'data', s: stream, o: slice.first, d: slice.data.toString('base64') })
      }
      next.sent[stream] = slice.end
    }
    if (exit) {
      send(next, { t: 'exit', ...exit })
    }
    return next
  }

  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    let self: Owner | null = null
    const helloTimer = setTimeout(() => socket.destroy(), CHAT_SURVIVE_HELLO_TIMEOUT_MS)
    const decoder = createLineDecoder((frame) => {
      if (!self) {
        clearTimeout(helloTimer)
        const hello = parseHello(frame)
        if (!hello) {
          return refuse(socket, 'malformed')
        }
        if (hello.v !== CHAT_SURVIVE_PROTOCOL_VERSION) {
          return refuse(socket, 'version')
        }
        if (!tokensMatch(options.token, hello.token)) {
          return refuse(socket, 'bad-token')
        }
        if (hello.fence < highestFence || finishing) {
          return refuse(socket, 'stale-fence')
        }
        self = accept(socket, hello)
        return
      }
      if (owner !== self || !frame) {
        return
      }
      if (frame.t === 'in' && typeof frame.d === 'string' && !exit) {
        child.stdin.write(Buffer.from(frame.d, 'base64'))
      } else if (frame.t === 'end') {
        child.stdin.end()
      } else if (frame.t === 'stop') {
        shutdown('closed')
      } else if (frame.t === 'release') {
        shutdown('released')
      }
    })
    socket.on('data', (chunk: Buffer) => {
      decoder.push(chunk)
      if (!self && decoder.pending() > CHAT_SURVIVE_MAX_HELLO_BYTES) {
        socket.destroy()
      }
    })
    socket.on('close', () => {
      clearTimeout(helloTimer)
      sockets.delete(socket)
      if (self && owner === self) {
        // The owner went without a word: the app quit or died. The provider carries on.
        owner = null
        armOrphanTimer()
      }
    })
  })

  const listening = await new Promise<boolean>((resolve) => {
    server.once('error', () => resolve(false))
    server.listen(options.socketPath, () => resolve(true))
  })
  if (!listening) {
    shutdown('closed')
    return { pid, status, done: ended.promise, close: () => ended.promise }
  }
  chmodSync(options.socketPath, 0o600)
  // The first owner has the same deadline as any later one.
  armOrphanTimer()

  function status(): ChatSurviveBrokerStatus {
    return {
      attached: owner !== null,
      orphaned: orphanTimer !== null,
      fence: highestFence,
      exit,
      out: rings.out.end,
      err: rings.err.end
    }
  }

  return {
    pid,
    status,
    done: ended.promise,
    close: () => {
      shutdown('closed')
      return ended.promise
    }
  }
}
