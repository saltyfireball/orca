// SLRM-1394: what a broker checks in a hello and sends back to the owner it accepts.
import type { ChatSurviveByteRing } from './chat-survive-byte-ring'
import {
  CHAT_SURVIVE_PROTOCOL_VERSION,
  encodeFrame,
  parseHello,
  tokensMatch,
  type ChatSurviveBrokerFrame,
  type ChatSurviveExit,
  type ChatSurviveHello,
  type ChatSurviveRefusalReason,
  type ChatSurviveStream
} from './chat-survive-protocol'

/** The hello in a first frame, or why it is refused. Fence and ownership are the broker's call. */
export function checkHello(
  frame: Record<string, unknown> | null,
  token: string
): ChatSurviveHello | ChatSurviveRefusalReason {
  const hello = parseHello(frame)
  if (!hello) {
    return 'malformed'
  }
  if (hello.v !== CHAT_SURVIVE_PROTOCOL_VERSION) {
    return 'version'
  }
  if (!tokensMatch(token, hello.token)) {
    return 'bad-token'
  }
  return hello
}

export function refusalFrame(reason: ChatSurviveRefusalReason): string {
  return encodeFrame({ t: 'refused', v: CHAT_SURVIVE_PROTOCOL_VERSION, reason })
}

/** The welcome, the replay from the offsets the owner holds, and the exit if there was one. */
export function welcomeFrames(
  rings: Record<ChatSurviveStream, ChatSurviveByteRing>,
  hello: ChatSurviveHello,
  pid: number,
  exit: ChatSurviveExit | null
): ChatSurviveBrokerFrame[] {
  const out = rings.out.sliceFrom(hello.from.out)
  const err = rings.err.sliceFrom(hello.from.err)
  const frames: ChatSurviveBrokerFrame[] = [
    {
      t: 'welcome',
      v: CHAT_SURVIVE_PROTOCOL_VERSION,
      pid,
      fence: hello.fence,
      out: { first: out.first, end: out.end, truncated: out.truncated },
      err: { first: err.first, end: err.end, truncated: err.truncated },
      exit
    }
  ]
  for (const [stream, slice] of [
    ['err', err],
    ['out', out]
  ] as const) {
    if (slice.data.length > 0) {
      frames.push({ t: 'data', s: stream, o: slice.first, d: slice.data.toString('base64') })
    }
  }
  if (exit) {
    frames.push({ t: 'exit', ...exit })
  }
  return frames
}

/** What the broker knows when a hello comes in. */
export type ChatSurviveHelloState = {
  token: string
  highestFence: number
  finishing: boolean
  /** The spawning process still owns the provider over the broker's stdio. */
  directHeld: boolean
}

/** The hello an owner may be accepted with, or why it is refused. */
export function admitHello(
  frame: Record<string, unknown> | null,
  state: ChatSurviveHelloState
): ChatSurviveHello | ChatSurviveRefusalReason {
  const hello = checkHello(frame, state.token)
  if (typeof hello === 'string') {
    return hello
  }
  // Only the spawning app's own takeover may reuse the fence; any other owner must go higher.
  const fresh =
    hello.takeover === true ? hello.fence >= state.highestFence : hello.fence > state.highestFence
  if (!fresh || state.finishing) {
    return 'stale-fence'
  }
  // Never two writers: while the spawning process lives, it alone owns the provider, and only it
  // (it holds the token) moves itself to the socket with a takeover.
  if (state.directHeld && hello.takeover !== true) {
    return 'busy'
  }
  return hello
}

/** What the current owner can ask of the broker. */
export type ChatSurviveOwnerActions = {
  input: (data: Buffer) => void
  end: () => void
  stop: () => void
  release: () => void
  detach: () => void
}

export function applyOwnerFrame(
  frame: Record<string, unknown>,
  actions: ChatSurviveOwnerActions
): void {
  const data = frame.d
  if (frame.t === 'in' && typeof data === 'string') {
    actions.input(Buffer.from(data, 'base64'))
  } else if (frame.t === 'end') {
    actions.end()
  } else if (frame.t === 'stop') {
    actions.stop()
  } else if (frame.t === 'release') {
    actions.release()
  } else if (frame.t === 'detach') {
    actions.detach()
  }
}
