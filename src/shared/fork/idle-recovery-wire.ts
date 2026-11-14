// Idle recovery (FORK.md): the contract the Decision inbox dialog, `orca inbox` and the host
// that answers all share. The runtime RPC methods and the window bridge carry the same
// payloads, so each side is built against this file alone.
import { z } from 'zod'
import type { IdleRecoveryChatKind, IdleRecoveryVerdictKind } from './idle-recovery'
import type { IdleRecoveryMode } from './idle-recovery-settings'

export const FORK_IDLE_RECOVERY_METHODS = {
  /** Chats waiting on the user or stalled, oldest first. */
  inbox: 'fork.idleRecovery.inbox',
  /** Send the user's answer to one waiting chat. */
  answer: 'fork.idleRecovery.answer',
  /** Leave one chat alone, or look at it again. */
  pause: 'fork.idleRecovery.pause',
  /** The mode, the classifier in use and the sweep's counts. */
  status: 'fork.idleRecovery.status'
} as const

export const FORK_IDLE_RECOVERY_CHANNELS = {
  /** renderer -> main (invoke), one per method above. */
  inbox: 'fork:idleRecovery:inbox',
  answer: 'fork:idleRecovery:answer',
  pause: 'fork:idleRecovery:pause',
  status: 'fork:idleRecovery:status',
  /** main -> renderer: the inbox changed; read it again. */
  changed: 'fork:idleRecovery:changed'
} as const

export const FORK_IDLE_RECOVERY_MAX_ANSWER_CHARS = 20_000

const ChatId = z.string().min(1).max(512)

export const ForkIdleRecoveryInboxParams = z.object({})
export const ForkIdleRecoveryStatusParams = z.object({})
export const ForkIdleRecoveryAnswerParams = z.object({
  chatId: ChatId,
  text: z.string().min(1).max(FORK_IDLE_RECOVERY_MAX_ANSWER_CHARS)
})
export const ForkIdleRecoveryPauseParams = z.object({
  chatId: ChatId,
  paused: z.boolean()
})

export type ForkIdleRecoveryAnswerRequest = z.infer<typeof ForkIdleRecoveryAnswerParams>
export type ForkIdleRecoveryPauseRequest = z.infer<typeof ForkIdleRecoveryPauseParams>

/** One chat in the Decision inbox. */
export type ForkIdleRecoveryInboxItem = {
  /** A native chat session id or a terminal agent pane key. */
  chatId: string
  kind: IdleRecoveryChatKind
  agent: string
  title: string
  workspace: string
  worktreeId: string | null
  /** Never 'finished': those are not listed. */
  verdict: Exclude<IdleRecoveryVerdictKind, 'finished'>
  question: string
  reason: string
  /** Epoch ms when this ending was first classified. */
  since: number
  wakes: number
  /** Epoch ms of the next wake, or null. */
  wakeAt: number | null
  paused: boolean
}

export type ForkIdleRecoveryInboxResult = {
  now: number
  mode: IdleRecoveryMode
  items: ForkIdleRecoveryInboxItem[]
}

/**
 * - sent: the answer went to the chat.
 * - not-found: this host has no such chat.
 * - not-waiting: the chat is not waiting on the user now.
 * - unavailable: idle recovery is off or not running here.
 */
export type ForkIdleRecoveryAnswerOutcome = 'sent' | 'not-found' | 'not-waiting' | 'unavailable'

export type ForkIdleRecoveryAnswerResult = {
  chatId: string
  result: ForkIdleRecoveryAnswerOutcome
}

export type ForkIdleRecoveryPauseResult = {
  chatId: string
  paused: boolean
  pausedCount: number
  /** False when this host cannot save settings; nothing changed. */
  saved: boolean
}

export type ForkIdleRecoveryStatusResult = {
  mode: IdleRecoveryMode
  /** True while the sweep timer runs on this host. */
  running: boolean
  classifier: 'command' | 'builtin'
  lastSweepAt: number | null
  waiting: number
  stalled: number
  paused: string[]
}

/** `window.api.forkIdleRecovery`; desktop only. */
export type ForkIdleRecoveryApi = {
  inbox: () => Promise<ForkIdleRecoveryInboxResult>
  answer: (request: ForkIdleRecoveryAnswerRequest) => Promise<ForkIdleRecoveryAnswerResult>
  pause: (request: ForkIdleRecoveryPauseRequest) => Promise<ForkIdleRecoveryPauseResult>
  status: () => Promise<ForkIdleRecoveryStatusResult>
  onChanged: (listener: () => void) => () => void
}
