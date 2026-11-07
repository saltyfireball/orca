// SLRM-1394: brokers this app instance claimed at startup recovery and holds until the chat's
// next start takes them for its provider child. A claim nothing takes in time is stopped, which is
// today's recovery outcome: the provider ends and the chat resumes from its saved history.
import type { ChatSurviveConnection } from './chat-survive-client'
import type { ChatSurviveRecord } from './chat-survive-registry'
import type { ChatSurviveStreamMark } from './chat-survive-stream-mark'

/** How long a claimed broker waits for the chat's start before it is stopped as today. */
const CLAIM_HOLD_MS = 60_000

export type ChatSurviveClaim = {
  readonly connection: ChatSurviveConnection
  readonly record: ChatSurviveRecord & { sessionId: string }
  readonly recordPath: string
  /** Where the earlier instance left off, in the broker's own offsets. */
  readonly mark: ChatSurviveStreamMark
  /** The fence this instance claimed the broker with. */
  readonly fence: number
}

const claims = new Map<string, { claim: ChatSurviveClaim; timer: NodeJS.Timeout }>()
/** Chats whose dropped claim's provider has not finished stopping yet. */
const stopping = new Set<string>()

export function holdChatSurviveClaim(claim: ChatSurviveClaim): void {
  dropChatSurviveClaim(claim.record.sessionId)
  const timer = setTimeout(() => dropChatSurviveClaim(claim.record.sessionId), CLAIM_HOLD_MS)
  timer.unref()
  claims.set(claim.record.sessionId, { claim, timer })
  // A broker that goes meanwhile leaves nothing to take.
  void claim.connection.ended.then(() => {
    if (claims.get(claim.record.sessionId)?.claim === claim) {
      clearTimeout(timer)
      claims.delete(claim.record.sessionId)
    }
  })
}

export function hasChatSurviveClaim(sessionId: string): boolean {
  return claims.has(sessionId)
}

/** The held claim for this chat, which the caller now owns; null when there is none. */
export function takeChatSurviveClaim(sessionId: string): ChatSurviveClaim | null {
  const held = claims.get(sessionId)
  if (!held) {
    return null
  }
  clearTimeout(held.timer)
  claims.delete(sessionId)
  return held.claim
}

/** Stops a claimed provider nothing took, as recovery does today. */
export function dropChatSurviveClaim(sessionId: string): void {
  const connection = takeChatSurviveClaim(sessionId)?.connection
  if (connection) {
    stopping.add(sessionId)
    connection.stop()
    void connection.exited.then(() => connection.release())
    void connection.ended.then(() => stopping.delete(sessionId))
  }
}

/** True while a dropped claim's provider may still write; no second provider may start then. */
export function chatSurviveClaimStopping(sessionId: string): boolean {
  return stopping.has(sessionId)
}
