// Idle recovery (FORK.md): the contract the Decision inbox dialog, `orca inbox` and the host
// that answers all share. The runtime RPC methods and the window bridge carry the same
// payloads, so each side is built against this file alone.
import { z } from 'zod'
import type { IdleRecoveryChatKind, IdleRecoveryVerdictKind } from './idle-recovery'
import type { IdleRecoveryMode } from './idle-recovery-settings'
import type { ForkPrBabysitListResult } from './pr-babysit-wire'
import type { ForkBotAsksReportRequest, ForkBotAsksReportResult } from './inbox-bot-asks'

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
  /** The PR babysitter's pull requests, for their status lines (SLRM-2386). */
  babysit: 'fork:idleRecovery:babysit',
  /** The bot asks a window reads (SLRM-2453), so new ones reach the notify targets once. */
  botAsks: 'fork:idleRecovery:botAsks',
  /** main -> renderer: the inbox changed; read it again. */
  changed: 'fork:idleRecovery:changed'
} as const

export const FORK_IDLE_RECOVERY_MAX_ANSWER_CHARS = 20_000

const ChatId = z.string().min(1).max(512)
/** Which list a row came from: absent is idle recovery's own; 'babysit' the PR babysitter's (SLRM-2386). */
const Source = z.enum(['babysit']).optional()

export const ForkIdleRecoveryInboxParams = z.object({})
export const ForkIdleRecoveryStatusParams = z.object({})
export const ForkIdleRecoveryAnswerParams = z.object({
  chatId: ChatId,
  text: z.string().min(1).max(FORK_IDLE_RECOVERY_MAX_ANSWER_CHARS),
  source: Source
})
export const ForkIdleRecoveryPauseParams = z.object({
  chatId: ChatId,
  paused: z.boolean(),
  source: Source
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
  /** Never 'finished': those are not listed. 'guard': an agent guard paused it (SLRM-2385); an
   *  answer lifts the pause, and so does Resume. */
  verdict: Exclude<IdleRecoveryVerdictKind, 'finished'> | 'guard'
  question: string
  reason: string
  /** Epoch ms when this ending was first classified. */
  since: number
  wakes: number
  /** Epoch ms of the next wake, or null. */
  wakeAt: number | null
  paused: boolean
  /** 'babysit': a pull request the PR babysitter stopped on (SLRM-2386); its Pause stops babysitting. */
  source?: 'babysit'
  /** The babysat pull request, `host/owner/repo#number`. */
  prKey?: string
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
 * - unavailable: idle recovery is off here, or the chat cannot take a message right now (a
 *   terminal that holds typed text or a dialog, or whose screen is not settled).
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
  /** The PR babysitter's pull requests on this host (SLRM-2386); absent in older builds. */
  babysit?: () => Promise<ForkPrBabysitListResult>
  /** The bot asks this window reads now (SLRM-2453); the main process tells new ones once. */
  reportBotAsks?: (request: ForkBotAsksReportRequest) => Promise<ForkBotAsksReportResult>
  onChanged: (listener: () => void) => () => void
}
