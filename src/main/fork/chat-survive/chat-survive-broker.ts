// SLRM-1394: hosts one chat provider so it can outlive the app instance that started it.
//
// The broker owns the provider's pipes. It logs stdout and stderr into bounded rings with absolute
// offsets and serves them to one owner at a time. The first owner can be the process that spawned
// the broker, over the broker's own stdio (`directOwner`); later owners say hello over a Unix
// socket with the token and a fence at least as high as the last one, and get everything from the
// offsets they already hold. When the owner goes (its socket closes, or the spawning process dies),
// the provider keeps running and the broker arms an orphan timer. With no owner by the deadline the
// broker stops the provider and leaves.
//
// Adopting a broker into a chat session (lease, journal, adapter) is described in
// docs/fork/chat-survive.md.
import { chmodSync, rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import type { Readable, Writable } from 'node:stream'
import { spawnProcess } from '@orca/process-host'
import type { PipedChildProcess } from '@orca/process-host/process-spec'
import { ChatSurviveByteRing } from './chat-survive-byte-ring'
import { checkHello, refusalFrame, welcomeFrames } from './chat-survive-broker-hello'
import {
  CHAT_SURVIVE_MAX_HELLO_BYTES,
  createLineDecoder,
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
  CHAT_SURVIVE_HELLO_TIMEOUT_MS,
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
  let directPoll: NodeJS.Timeout | null = null
  let finishing: ChatSurviveBrokerEndReason | null = null

  const child: PipedChildProcess = spawnProcess({
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

  const send = (target: Owner, frame: ChatSurviveBrokerFrame): void => {
    if (!target.socket.destroyed) {
      target.socket.write(encodeFrame(frame))
    }
  }

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
    if (owner) {
      send(owner, { t: 'data', s: stream, o: offset, d: data.toString('base64') })
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
    if (directPoll) {
      clearInterval(directPoll)
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
    signalTarget(pid, 'SIGTERM', group)
    killTimer = setTimeout(() => signalTarget(pid, 'SIGKILL', group), stopGraceMs)
    exitObserved.then(finish, finish)
  }

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

  // The spawning process is gone; whatever it had not read stays in the rings.
  const loseDirectOwner = (): void => {
    const lost = direct
    if (!lost) {
      return
    }
    direct = null
    if (directPoll) {
      clearInterval(directPoll)
      directPoll = null
    }
    unwireDirectOwner(lost)
    child.stdout.resume()
    child.stderr.resume()
    armOrphanTimer()
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
    socket.on('error', () => {})
    let self: Owner | null = null
    const helloTimer = setTimeout(() => socket.destroy(), CHAT_SURVIVE_HELLO_TIMEOUT_MS)
    const decoder = createLineDecoder((frame) => {
      if (!self) {
        clearTimeout(helloTimer)
        const hello = checkHello(frame, options.token)
        if (typeof hello === 'string') {
          return void socket.end(refusalFrame(hello))
        }
        // Never two writers: while the spawning process lives, it alone owns the provider.
        if (direct && !direct.gone()) {
          return void socket.end(refusalFrame('busy'))
        }
        loseDirectOwner()
        if (hello.fence < highestFence || finishing) {
          return void socket.end(refusalFrame('stale-fence'))
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
  if (!direct) {
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
