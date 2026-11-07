// SLRM-1394: the chat-survive broker's options, results and small process helpers.
import type { Readable, Writable } from 'node:stream'
import type { ChatSurviveExit } from './chat-survive-protocol'

export const CHAT_SURVIVE_DEFAULT_OUT_RING_BYTES = 16 * 1024 * 1024
export const CHAT_SURVIVE_DEFAULT_ERR_RING_BYTES = 256 * 1024
export const CHAT_SURVIVE_DEFAULT_STOP_GRACE_MS = 3_000
export const CHAT_SURVIVE_HELLO_TIMEOUT_MS = 5_000
/** After the provider exits, how long its pipes get to deliver their last bytes. */
export const EXIT_DRAIN_MS = 1_000

/** The process that spawned the broker, speaking to it over the broker's own stdio. */
export type ChatSurviveDirectOwner = {
  input: Readable
  output: Writable
  errOutput: Writable
  /** True once that process is gone; it never comes back. */
  gone: () => boolean
}

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
  /**
   * True (the default) puts the provider in its own process group and stops the group. False
   * keeps it in the broker's group and signals only its pid: a provider supervisor stops its own
   * group and must not be SIGKILLed before it has.
   */
  detached?: boolean
  directOwner?: ChatSurviveDirectOwner
}

export type ChatSurviveBrokerEndReason =
  | 'orphan-timeout'
  | 'released'
  | 'closed'
  | 'spawn-failed'
  /** The provider exited while the direct owner was attached; it has had all the output. */
  | 'exited'

export type ChatSurviveBrokerEnd = {
  reason: ChatSurviveBrokerEndReason
  exit: ChatSurviveExit | null
}

export type ChatSurviveBrokerStatus = {
  attached: boolean
  /** The spawning process still owns the broker over stdio. */
  direct: boolean
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
  /** Stops the provider and closes the broker. */
  close: () => Promise<ChatSurviveBrokerEnd>
}

export function signalTarget(pid: number, signal: NodeJS.Signals, group: boolean): void {
  try {
    process.kill(group ? -pid : pid, signal)
  } catch {
    // ESRCH: already gone.
  }
}

export function flushed(stream: Writable): Promise<void> {
  if (stream.destroyed || stream.writableEnded) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    stream.write('', () => resolve())
  })
}

const IDLE_STATUS: ChatSurviveBrokerStatus = {
  attached: false,
  direct: false,
  orphaned: false,
  fence: 0,
  exit: null,
  out: 0,
  err: 0
}

/** A broker that never got its provider running. */
export function failedChatSurviveBroker(): ChatSurviveBroker {
  const end: ChatSurviveBrokerEnd = { reason: 'spawn-failed', exit: null }
  return {
    pid: -1,
    status: () => IDLE_STATUS,
    done: Promise.resolve(end),
    close: () => Promise.resolve(end)
  }
}
