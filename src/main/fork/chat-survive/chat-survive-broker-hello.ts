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
