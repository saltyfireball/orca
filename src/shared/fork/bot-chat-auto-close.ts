// Auto-close finished bot chats (FORK.md "Auto-close finished bot chats", BAD-734). A bot opens one
// chat per routed card or handoff and nothing ended them, so a bot listed every chat it ever had.
// This is the rule that says which chat closes and why. Pure: facts in, verdict out, no I/O.
import type { BotChatTreeChat } from '../bots/bot-chat-tree'

export type ForkBotChatAutoCloseSettings = {
  /** Fork (BAD-734): close finished bot chats by themselves (card done or canceled, handoff answered, or idle too long); unset is on. */
  forkBotChatAutoClose?: boolean
  /** Fork (BAD-734): hours a bot chat may sit idle before it closes; unset is 24. */
  forkBotChatAutoCloseIdleHours?: number
  /** Fork (BAD-734): minutes a finished chat that Orca started (card route, handoff, quick task) stays open after its last activity, so a quick follow-up lands there; unset is 10. */
  forkBotChatAutoCloseGraceMinutes?: number
}

export const FORK_BOT_CHAT_AUTO_CLOSE_DEFAULT_IDLE_HOURS = 24
export const FORK_BOT_CHAT_AUTO_CLOSE_DEFAULT_GRACE_MINUTES = 10
export const FORK_BOT_CHAT_AUTO_CLOSE_IDLE_CHOICES: readonly number[] = [1, 6, 12, 24, 72, 168]
export const FORK_BOT_CHAT_AUTO_CLOSE_GRACE_CHOICES: readonly number[] = [1, 5, 10, 30, 60]

const MAX_HOURS = 24 * 365
const MAX_MINUTES = 24 * 60

/** One key of a settings object, or undefined; shared with the other fork auto-close settings. */
export function readForkSetting(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined
}

/** A whole number from 1 to `max`, else `fallback`. */
export function wholeForkSetting(value: unknown, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max
    ? value
    : fallback
}

/** On unless set false. */
export function forkBotChatAutoCloseEnabled(settings: unknown): boolean {
  return readForkSetting(settings, 'forkBotChatAutoClose') !== false
}

export function forkBotChatAutoCloseIdleMs(settings: unknown): number {
  return (
    wholeForkSetting(
      readForkSetting(settings, 'forkBotChatAutoCloseIdleHours'),
      MAX_HOURS,
      FORK_BOT_CHAT_AUTO_CLOSE_DEFAULT_IDLE_HOURS
    ) * 3_600_000
  )
}

export function forkBotChatAutoCloseGraceMs(settings: unknown): number {
  return (
    wholeForkSetting(
      readForkSetting(settings, 'forkBotChatAutoCloseGraceMinutes'),
      MAX_MINUTES,
      FORK_BOT_CHAT_AUTO_CLOSE_DEFAULT_GRACE_MINUTES
    ) * 60_000
  )
}

/** A card key such as BAD-12 in a chat title ("BAD-12: Merge PR 95"), or null. */
export function forkBotChatCardKey(title: string): string | null {
  return /\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/.exec(title)?.[1] ?? null
}

export type ForkBotChatCardState = 'done' | 'canceled' | 'open' | 'unknown'

/** Linear's state types for a finished card. */
export function forkCardStateOf(stateType: string | undefined | null): ForkBotChatCardState {
  if (stateType === 'completed') {
    return 'done'
  }
  if (stateType === 'canceled') {
    return 'canceled'
  }
  return stateType ? 'open' : 'unknown'
}

/** What the host knows of one chat beyond the chat tree's row. Times are epoch ms. */
export type ForkBotChatCloseFacts = {
  chat: Pick<
    BotChatTreeChat,
    | 'chatId'
    | 'title'
    | 'origin'
    | 'live'
    | 'lastActiveAt'
    | 'closed'
    | 'runningTotal'
    | 'running'
    | 'unseen'
  >
  /** Orca opened it (card route, handoff, quick task, an outside thread), not the owner. */
  autoStarted: boolean
  /** Mail for the chat that no turn has read yet. */
  queued: boolean
  /** An open ask or needs-you item names the chat. */
  openItem: boolean
  /** The last time the owner typed into it, when known. */
  ownerTypedAt: number | null
  /** The latest mail the chat received (its handoff, a follow-up, a worker's report). */
  lastInboundAt: number | null
  /** When it last reported back to whoever handed it off (worker_done or a handoff answer). */
  reportedBackAt: number | null
  cardState: ForkBotChatCardState
}

export type ForkBotChatCloseReason = 'card-finished' | 'job-ended' | 'idle'

export type ForkBotChatKeepReason =
  | 'home'
  | 'already-closed'
  | 'working'
  | 'queued'
  | 'needs-you'
  | 'owner-typed'
  | 'grace'
  | 'in-use'

export type ForkBotChatVerdict =
  | { close: true; reason: ForkBotChatCloseReason }
  | { close: false; keep: ForkBotChatKeepReason }

export type ForkBotChatCloseTimes = {
  now: number
  idleMs: number
  graceMs: number
}

/** A turn Orca delivered as mail starts with this banner; a person's typed turn does not. */
export function forkIsMailPrompt(prompt: string | undefined): boolean {
  return prompt === undefined || prompt.startsWith('─')
}

/**
 * When the owner last typed into the chat: its last turn, unless that turn was Orca's mail or the
 * message that started the chat (a turn begun within a minute of creation).
 */
export function forkOwnerTypedAt(
  turn: { at: number; prompt?: string } | undefined,
  createdAt: number | undefined
): number | null {
  if (!turn || forkIsMailPrompt(turn.prompt)) {
    return null
  }
  return createdAt !== undefined && turn.at - createdAt < 60_000 ? null : turn.at
}

export function forkBotChatCloseVerdict(
  facts: ForkBotChatCloseFacts,
  times: ForkBotChatCloseTimes
): ForkBotChatVerdict {
  const { chat } = facts
  if (chat.origin === 'home') {
    return { close: false, keep: 'home' }
  }
  if (chat.closed) {
    return { close: false, keep: 'already-closed' }
  }
  if (chat.live === 'needs-you' || chat.running.some((worker) => worker.state === 'needs-you')) {
    return { close: false, keep: 'needs-you' }
  }
  if (facts.openItem) {
    return { close: false, keep: 'needs-you' }
  }
  if (chat.live !== 'idle' || chat.runningTotal > 0) {
    return { close: false, keep: 'working' }
  }
  if (facts.queued) {
    return { close: false, keep: 'queued' }
  }
  const quiet = times.now - chat.lastActiveAt
  const typedRecently = facts.ownerTypedAt !== null && times.now - facts.ownerTypedAt < times.idleMs
  if (typedRecently) {
    return { close: false, keep: 'owner-typed' }
  }
  // A card that went Done or Canceled ends its chat; a quick follow-up still gets the grace.
  if (facts.cardState === 'done' || facts.cardState === 'canceled') {
    return quiet >= times.graceMs
      ? { close: true, reason: 'card-finished' }
      : { close: false, keep: 'grace' }
  }
  // Its job ended: it answered after the last mail it got. New mail after the answer reopens the job.
  const answered =
    facts.autoStarted &&
    facts.reportedBackAt !== null &&
    (facts.lastInboundAt === null || facts.reportedBackAt >= facts.lastInboundAt)
  if (answered) {
    return quiet >= times.graceMs
      ? { close: true, reason: 'job-ended' }
      : { close: false, keep: 'grace' }
  }
  return quiet >= times.idleMs ? { close: true, reason: 'idle' } : { close: false, keep: 'in-use' }
}

export type ForkBotChatOutcome = 'done' | 'failed' | 'blocked'

/** The chat's result from its final reply: blocked and failed are named by the words an agent uses. */
export function forkBotChatOutcome(reply: string | undefined): ForkBotChatOutcome {
  const text = (reply ?? '').toLowerCase()
  if (/\b(blocked|waiting on|needs (a )?decision|cannot proceed|can't proceed)\b/.test(text)) {
    return 'blocked'
  }
  if (/\b(failed|failure|error|could not|couldn't|unable to)\b/.test(text)) {
    return 'failed'
  }
  return 'done'
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}...` : flat
}

/** The one compact row a closed auto-started chat leaves in its bot's Home Chat. Plain ASCII. */
export function forkBotChatClosedNote(input: {
  title: string
  chatId: string
  cardKey: string | null
  cardUrl?: string
  outcome: ForkBotChatOutcome
  reply?: string
}): string {
  const card = input.cardKey ? ` (${input.cardKey}${input.cardUrl ? ` ${input.cardUrl}` : ''})` : ''
  const detail = input.reply ? `: ${oneLine(input.reply, 200)}` : ''
  return `Closed chat "${oneLine(input.title, 80)}"${card} - ${input.outcome}${detail} [chat:${input.chatId}]`
}
