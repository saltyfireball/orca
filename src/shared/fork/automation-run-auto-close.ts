// Auto-close finished automation run chats (FORK.md, BAD-848). A fresh-session automation opens a
// new chat tab every run and nothing closed it, so the tabs of runs from days ago piled up. This is
// the rule that says which run's chat closes and why. Pure: facts in, verdict out, no I/O.
import { readForkSetting, wholeForkSetting } from './bot-chat-auto-close'

export type ForkAutomationRunAutoCloseSettings = {
  /** Fork (BAD-848): close a finished automation run's chat tab by itself after a grace, with its history kept; unset is on. */
  forkAutomationRunAutoClose?: boolean
  /** Fork (BAD-848): minutes a finished automation run's chat stays open after the run ended; unset is 60. */
  forkAutomationRunAutoCloseGraceMinutes?: number
}

export const FORK_AUTOMATION_RUN_AUTO_CLOSE_DEFAULT_GRACE_MINUTES = 60
export const FORK_AUTOMATION_RUN_AUTO_CLOSE_GRACE_CHOICES: readonly number[] = [
  5, 15, 30, 60, 240, 1440
]
/** A turn that settled this long after the run ended is someone else's, not the run's. */
export const FORK_AUTOMATION_RUN_TURN_SLACK_MS = 30_000

export function forkAutomationRunAutoCloseEnabled(settings: unknown): boolean {
  return readForkSetting(settings, 'forkAutomationRunAutoClose') !== false
}

export function forkAutomationRunAutoCloseGraceMs(settings: unknown): number {
  return (
    wholeForkSetting(
      readForkSetting(settings, 'forkAutomationRunAutoCloseGraceMinutes'),
      7 * 24 * 60,
      FORK_AUTOMATION_RUN_AUTO_CLOSE_DEFAULT_GRACE_MINUTES
    ) * 60_000
  )
}

/** What the host knows of one run's chat. Times are epoch ms. */
export type ForkAutomationRunCloseFacts = {
  /** The run's status is final. */
  finished: boolean
  /** The automation reuses one chat every run. */
  reuseSession: boolean
  /** The chat is a bot's Home Chat. */
  homeChat: boolean
  /** Another run names the same chat. */
  sharedChat: boolean
  /** The chat's saved record; null when this host has none. */
  chat: {
    createdAt: number
    tabOpen: boolean
    lastTurn?: { state: 'open' | 'settled'; at: number }
  } | null
  runCreatedAt: number
  /** When the run ended: its output's capture time, else its dispatch time. */
  endedAt: number
  /** endedAt is the output's capture time, so a later turn can be told from the run's own. */
  endKnown: boolean
  pinned: boolean
  /** Orca closed it before and someone opened it again. */
  reopened: boolean
  /** Its agent is in a turn or waiting on a person; null when that cannot be read. */
  working: boolean | null
}

export type ForkAutomationRunKeepReason =
  | 'running'
  | 'reuse-session'
  | 'home'
  | 'shared-chat'
  | 'no-chat'
  | 'person-chat'
  | 'already-closed'
  | 'pinned'
  | 'reopened'
  | 'working'
  | 'unreadable'
  | 'typed'
  | 'grace'

export type ForkAutomationRunVerdict =
  | { close: true }
  | { close: false; keep: ForkAutomationRunKeepReason }

export function forkAutomationRunCloseVerdict(
  facts: ForkAutomationRunCloseFacts,
  times: { now: number; graceMs: number }
): ForkAutomationRunVerdict {
  const keep = (reason: ForkAutomationRunKeepReason): ForkAutomationRunVerdict => ({
    close: false,
    keep: reason
  })
  if (!facts.finished) {
    return keep('running')
  }
  if (facts.reuseSession) {
    return keep('reuse-session')
  }
  if (facts.homeChat) {
    return keep('home')
  }
  if (facts.sharedChat) {
    return keep('shared-chat')
  }
  const { chat } = facts
  if (!chat) {
    return keep('no-chat')
  }
  // A chat older than the run is one the run was sent into, not one it opened.
  if (chat.createdAt < facts.runCreatedAt) {
    return keep('person-chat')
  }
  if (!chat.tabOpen) {
    return keep('already-closed')
  }
  if (facts.pinned) {
    return keep('pinned')
  }
  if (facts.reopened) {
    return keep('reopened')
  }
  if (chat.lastTurn?.state === 'open' || facts.working === true) {
    return keep('working')
  }
  if (facts.working === null) {
    return keep('unreadable')
  }
  const turn = chat.lastTurn
  const typed =
    turn !== undefined &&
    (!facts.endKnown || turn.at > facts.endedAt + FORK_AUTOMATION_RUN_TURN_SLACK_MS)
  if (typed) {
    return keep('typed')
  }
  return times.now - facts.endedAt >= times.graceMs ? { close: true } : keep('grace')
}
