// Sleepers (FORK.md): sleep now for native chats. It never stops a provider itself: it runs the
// stock idle sweep on the chat with no idle window, so the sweep's owed-work checks (a turn,
// queued or mid-delivery sends, open dispatches, prompts, child work, a provider that does not
// confirm idle) refuse a busy chat exactly as they do on a timer. The result reads the host
// again afterward, so "asleep" means the provider really stopped.
import type { ForkSleepOutcome, ForkSleepResult } from '../../../shared/fork/sleepers-wire'

export type ForkSleepChatState = {
  /** The host has a record of this chat. */
  known: boolean
  /** The provider process runs. */
  processAlive: boolean
  /** A turn runs or the provider is still starting; the sweep would refuse. */
  busy: boolean
}

export type ForkSleepersServiceDeps = {
  /** Null when the chat host is not running in this process. */
  chatState: (sessionId: string) => ForkSleepChatState | null
  /** Null when the host's idle sweep has not been built. */
  sweepNow: ((sessionId: string) => Promise<void>) | null
}

export async function sleepChatNow(
  deps: ForkSleepersServiceDeps,
  sessionId: string
): Promise<ForkSleepResult> {
  const before = deps.chatState(sessionId)
  if (!before || !deps.sweepNow) {
    return 'unavailable'
  }
  if (!before.known) {
    return 'not-found'
  }
  if (!before.processAlive) {
    return 'already-asleep'
  }
  if (before.busy) {
    return 'busy'
  }
  try {
    await deps.sweepNow(sessionId)
  } catch {
    return 'busy'
  }
  return deps.chatState(sessionId)?.processAlive === false ? 'asleep' : 'busy'
}

/** One chat at a time, so a bulk sleep never stops many providers at once. */
export async function sleepChatsNow(
  deps: ForkSleepersServiceDeps,
  sessionIds: readonly string[]
): Promise<ForkSleepOutcome[]> {
  const outcomes: ForkSleepOutcome[] = []
  for (const sessionId of sessionIds) {
    outcomes.push({ sessionId, result: await sleepChatNow(deps, sessionId) })
  }
  return outcomes
}
