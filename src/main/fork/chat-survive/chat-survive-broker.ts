// SLRM-1394: hosts one chat provider so it can outlive the app instance that started it.
//
// The broker owns the provider's pipes. It logs stdout and stderr into bounded rings with absolute
// offsets and serves them to one owner at a time. The first owner can be the process that spawned
// the broker, over the broker's own stdio (`directOwner`); later owners say hello over a Unix
// socket with the token and a fence at least as high as the last one, and get everything from the
// offsets they already hold. When the owner hands the provider off (a `detach` frame, then its
// socket closes) the provider keeps running and the broker arms an orphan timer; with no owner by
// the deadline the broker stops the provider and leaves. An owner lost any other way (a crash, a
// socket gone without a word, the spawning process dead) stops the provider, as its supervisor
// would today.
//
// Adopting a broker into a chat session (lease, journal, adapter) is described in
// docs/fork/chat-survive.md.
import { chmod, rm } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import type { Readable, Writable } from 'node:stream'
import { spawnProcess } from '@orca/process-host'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { ChatSurviveByteRing } from './chat-survive-byte-ring'
import { serveChatSurviveConnection } from './chat-survive-broker-connection'
import { welcomeFrames } from './chat-survive-broker-hello'
import {
  encodeFrame,
  type ChatSurviveBrokerFrame,
  type ChatSurviveExit,
  type ChatSurviveHello,
  type ChatSurviveStream
} from './chat-survive-protocol'
import {
  CHAT_SURVIVE_DEFAULT_ERR_RING_BYTES,
  CHAT_SURVIVE_DEFAULT_OUT_RING_BYTES,
  CHAT_SURVIVE_DEFAULT_STOP_GRACE_MS,
  EXIT_DRAIN_MS,
  failedChatSurviveBroker,
  flushed,
  signalTarget,
  type ChatSurviveBroker,
  type ChatSurviveBrokerEnd,
  type ChatSurviveBrokerEndReason,
  type ChatSurviveBrokerOptions,
  type ChatSurviveBrokerStatus,
  type ChatSurviveDirectOwner
} from './chat-survive-broker-types'
import { unwireDirectOwner, wireDirectOwner } from './chat-survive-direct-owner'

export type * from './chat-survive-broker-types'

type Owner = { socket: Socket; fence: number }

export async function startChatSurviveBroker(
  options: ChatSurviveBrokerOptions
): Promise<ChatSurviveBroker> {
  const stopGraceMs = options.stopGraceMs ?? CHAT_SURVIVE_DEFAULT_STOP_GRACE_MS
  const group = options.detached ?? true
  const rings: Record<ChatSurviveStream, ChatSurviveByteRing> = {
    out: new ChatSurviveByteRing(options.outRingBytes ?? CHAT_SURVIVE_DEFAULT_OUT_RING_BYTES),
    err: new ChatSurviveByteRing(options.errRingBytes ?? CHAT_SURVIVE_DEFAULT_ERR_RING_BYTES)
  }
  const ended = Promise.withResolvers<ChatSurviveBrokerEnd>()
  let owner: Owner | null = null
  let direct: ChatSurviveDirectOwner | null = options.directOwner ?? null
  let highestFence = 0
  let exit: ChatSurviveExit | null = null
  let orphanTimer: NodeJS.Timeout | null = null
  let killTimer: NodeJS.Timeout | null = null
  let directPoll: (() => void) | null = null
  let finishing: ChatSurviveBrokerEndReason | null = null

  const child: ChildProcessWithoutNullStreams = spawnProcess({
    program: options.command,
    args: options.args,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env: options.env ?? process.env,
    stdio: 'pipe',
    detached: group
  })
  const spawned = await new Promise<boolean>((resolve) => {
    child.once('spawn', () => resolve(true))
    child.once('error', () => resolve(false))
  })
  if (!spawned || child.pid === undefined) {
    return failedChatSurviveBroker()
  }
  const pid = child.pid
  const childStreams: Record<ChatSurviveStream, Readable> = {
    out: child.stdout,
    err: child.stderr
  }
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    stream.on('error', () => {})
  }

  /** False when the socket is backed up; it says `drain` when it takes more. */
  const send = (target: Owner, frame: ChatSurviveBrokerFrame): boolean =>
    target.socket.destroyed || target.socket.write(encodeFrame(frame))

  const directSink = (stream: ChatSurviveStream): Writable | null =>
    direct ? (stream === 'out' ? direct.output : direct.errOutput) : null

  const relay = (stream: ChatSurviveStream, data: Buffer): void => {
    const offset = rings[stream].end
    rings[stream].append(data)
    const sink = directSink(stream)
    if (sink) {
      // The app reads at its own pace, as it does from a provider it spawned itself.
      if (!sink.write(data)) {
        childStreams[stream].pause()
        sink.once('drain', () => childStreams[stream].resume())
      }
      return
    }
    if (owner && !send(owner, { t: 'data', s: stream, o: offset, d: data.toString('base64') })) {
      // The same pace over the socket; a socket that closes instead resumes the stream.
      childStreams[stream].pause()
      owner.socket.once('drain', () => childStreams[stream].resume())
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
    directPoll?.()
    const finish = (): void => {
      if (killTimer) {
        clearTimeout(killTimer)
      }
      for (const socket of sockets) {
        socket.destroy()
      }
      server.close(() => {
        // Our own name; nobody else binds it. Gone before `done` settles, as before.
        void rm(options.socketPath, { force: true })
          .catch(() => undefined)
          .then(() => ended.resolve({ reason, exit }))
      })
    }
    if (exit) {
      finish()
      return
    }
    signalTarget(pid, 'SIGTERM', group)
    killTimer = setTimeout(() => signalTarget(pid, 'SIGKILL', group), stopGraceMs)
    exitObserved.then(finish, finish)
  }

  // A function, so the checks after an await read the value as it is then.
  const isFinishing = (): boolean => finishing !== null

  const armOrphanTimer = (): void => {
    if (orphanTimer || finishing) {
      return
    }
    orphanTimer = setTimeout(() => {
      orphanTimer = null
      if (!owner && !direct) {
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
        if (group) {
          // The provider's helpers die with it.
          signalTarget(pid, 'SIGKILL', true)
        }
        if (owner) {
          send(owner, { t: 'exit', code, signal })
        }
        resolve()
        const attached = direct
        if (attached) {
          // The direct owner judges the provider by this process's exit, after its last output.
          void Promise.all([flushed(attached.output), flushed(attached.errOutput)]).then(() =>
            shutdown('exited')
          )
        }
      }
    })
  })

  // The spawning process moved to the socket or is gone; what it had not read stays in the rings.
  const dropDirectOwner = (): void => {
    const lost = direct
    if (!lost) {
      return
    }
    direct = null
    directPoll?.()
    directPoll = null
    unwireDirectOwner(lost)
    child.stdout.resume()
    child.stderr.resume()
  }

  // Gone without a hand-off (a crash, a forced exit): nobody can resume it, so stop as today.
  const loseDirectOwner = (): void => {
    if (direct) {
      dropDirectOwner()
      shutdown('closed')
    }
  }

  if (direct) {
    const attached = direct
    directPoll = wireDirectOwner(attached, {
      stdin: child.stdin,
      current: () => direct === attached,
      providerExited: () => exit !== null,
      lose: loseDirectOwner
    })
  }

  const accept = (socket: Socket, hello: ChatSurviveHello): Owner => {
    const previous = owner
    const next: Owner = { socket, fence: hello.fence }
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
    for (const frame of welcomeFrames(rings, hello, pid, exit)) {
      send(next, frame)
    }
    return next
  }

  server.on('connection', (socket) => {
    sockets.add(socket)
    serveChatSurviveConnection<Owner>(socket, {
      helloState: () => ({
        token: options.token,
        highestFence,
        finishing: finishing !== null,
        directHeld: direct !== null && !direct.gone()
      }),
      accept: (accepted, hello) => {
        dropDirectOwner()
        return accept(accepted, hello)
      },
      isOwner: (self) => owner === self,
      actions: {
        input: (data) => {
          if (!exit) {
            child.stdin.write(data)
          }
        },
        end: () => child.stdin.end(),
        stop: () => shutdown('closed'),
        release: () => shutdown('released')
      },
      lost: (handedOff) => {
        owner = null
        child.stdout.resume()
        child.stderr.resume()
        // Handed off at quit, the provider waits for the next app; otherwise it stops as today.
        if (handedOff) {
          armOrphanTimer()
        } else {
          shutdown('closed')
        }
      },
      closed: (closed) => sockets.delete(closed)
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
  // Before the orphan timer and before any owner can reach the socket by its path.
  try {
    await chmod(options.socketPath, 0o600)
  } catch (error) {
    // The direct owner died meanwhile and finish already removed the socket: the broker is
    // ending on its own, and the provider it spawned stops with it.
    if (!(isFinishing() && isMissing(error))) {
      throw error
    }
  }
  if (!direct && !isFinishing()) {
    // The first socket owner has the same deadline as any later one.
    armOrphanTimer()
  }

  function status(): ChatSurviveBrokerStatus {
    return {
      attached: owner !== null || direct !== null,
      direct: direct !== null,
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

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
