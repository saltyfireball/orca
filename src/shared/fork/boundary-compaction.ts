// Boundary compaction (FORK.md): its settings and its rule. An agent compacts on its own when
// its context fills, which is nearly always in the middle of a turn. With the mode on, the app
// asks an idle native chat to compact between turns instead, once its context is past a
// threshold. The agent's own compaction stays as it is. Everything ships off: while
// `forkBoundaryCompactMode` is not 'on', nothing here runs.
import { parseAgentJournalItemKey } from '../agent-session/journal/agent-session-journal-item-key'
import type { ForkGlobalSettings } from './fork-global-settings'

export type BoundaryCompactionMode = 'off' | 'on'

export const BOUNDARY_COMPACTION_DEFAULT_THRESHOLD_TOKENS = 120_000
export const BOUNDARY_COMPACTION_DEFAULT_IDLE_SECONDS = 120
export const BOUNDARY_COMPACTION_DEFAULT_MAX_WAIT_MINUTES = 20
export const BOUNDARY_COMPACTION_MIN_THRESHOLD_TOKENS = 1000
export const BOUNDARY_COMPACTION_MAX_THRESHOLD_TOKENS = 100_000_000
export const BOUNDARY_COMPACTION_MIN_IDLE_SECONDS = 10
export const BOUNDARY_COMPACTION_MAX_IDLE_SECONDS = 24 * 60 * 60
export const BOUNDARY_COMPACTION_MAX_WAIT_MINUTES = 24 * 60

export const FORK_BOUNDARY_COMPACTION_CHANNELS = {
  /** renderer -> main: the native chat session ids whose message box holds text or an image now
   *  (replaces the window's last list). */
  typed: 'fork:boundaryCompaction:typed'
} as const

/** Most session ids one report may carry. */
export const FORK_BOUNDARY_COMPACTION_MAX_TYPED = 2000

export type ForkBoundaryCompactionApi = {
  /** Report the native chats whose message box is not empty. */
  setTyped: (sessionIds: string[]) => void
}

export type BoundaryCompactionSettings = {
  mode: BoundaryCompactionMode
  thresholdTokens: number
  idleSeconds: number
  preferCold: boolean
  maxWaitMinutes: number
}

type SettingKey = keyof Pick<
  ForkGlobalSettings,
  | 'forkBoundaryCompactMode'
  | 'forkBoundaryCompactThresholdTokens'
  | 'forkBoundaryCompactIdleSeconds'
  | 'forkBoundaryCompactPreferCold'
  | 'forkBoundaryCompactMaxWaitMinutes'
>

/** Any settings object; values are checked here, so a hand-edited file cannot break a reader. */
export type BoundaryCompactionSettingsSource =
  | Partial<Record<SettingKey, unknown>>
  | null
  | undefined

function wholeNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback
}

export function readBoundaryCompactionSettings(
  settings: BoundaryCompactionSettingsSource
): BoundaryCompactionSettings {
  return {
    mode: settings?.forkBoundaryCompactMode === 'on' ? 'on' : 'off',
    thresholdTokens: wholeNumber(
      settings?.forkBoundaryCompactThresholdTokens,
      BOUNDARY_COMPACTION_MIN_THRESHOLD_TOKENS,
      BOUNDARY_COMPACTION_MAX_THRESHOLD_TOKENS,
      BOUNDARY_COMPACTION_DEFAULT_THRESHOLD_TOKENS
    ),
    idleSeconds: wholeNumber(
      settings?.forkBoundaryCompactIdleSeconds,
      BOUNDARY_COMPACTION_MIN_IDLE_SECONDS,
      BOUNDARY_COMPACTION_MAX_IDLE_SECONDS,
      BOUNDARY_COMPACTION_DEFAULT_IDLE_SECONDS
    ),
    preferCold: settings?.forkBoundaryCompactPreferCold !== false,
    maxWaitMinutes: wholeNumber(
      settings?.forkBoundaryCompactMaxWaitMinutes,
      1,
      BOUNDARY_COMPACTION_MAX_WAIT_MINUTES,
      BOUNDARY_COMPACTION_DEFAULT_MAX_WAIT_MINUTES
    )
  }
}

/** True while boundary compaction may look at chats at all. */
export function boundaryCompactionEnabled(settings: BoundaryCompactionSettingsSource): boolean {
  return settings?.forkBoundaryCompactMode === 'on'
}

/**
 * How long a chat must have rested before it may be compacted. Without `preferCold` that is the
 * idle time. With it, the chat also waits until its prompt cache has expired (`cacheWindowMs`
 * with no provider call), or until `maxWaitMinutes` of rest have passed, whichever comes first:
 * a warm cache is worth keeping, because the next message would read it at the cached price.
 */
export function boundaryCompactionDueAt(
  rest: { idleSince: number; lastCallAt: number; cacheWindowMs: number },
  settings: Pick<BoundaryCompactionSettings, 'idleSeconds' | 'preferCold' | 'maxWaitMinutes'>
): number {
  const idleDue = rest.idleSince + settings.idleSeconds * 1000
  if (!settings.preferCold) {
    return idleDue
  }
  const coldAt = Math.max(rest.idleSince, rest.lastCallAt) + rest.cacheWindowMs
  const waitedEnough = rest.idleSince + settings.maxWaitMinutes * 60_000
  return Math.max(idleDue, Math.min(coldAt, waitedEnough))
}

/** Why a chat is left alone. Each is one line of the guide's "never compacted" list. */
export type BoundaryCompactionRefusal =
  | 'not-compactable'
  | 'asleep'
  | 'working'
  | 'background-work'
  | 'paused'
  | 'typed-text'
  | 'typed-unknown'
  | 'queued-message'
  | 'not-idle-long-enough'
  | 'no-request'
  | 'already-compacted'
  | 'already-tried'
  | 'context-unknown'
  | 'below-threshold'

/** What is known of a chat without reading its journal. */
export type BoundaryCompactionRestFacts = {
  /** The chat's agent says it can compact on request. */
  compactable: boolean
  /** This host runs the chat's agent process, and it has finished starting. */
  awake: boolean
  /** A turn is running, a prompt waits on the user, or the chat is being stopped or restarted. */
  inTurn: boolean
  /** A background task, monitor, sub-agent or other child of the chat has not finished. */
  backgroundRunning: boolean
  paused: boolean
  /** Whether the message box holds text; null when no window has reported. */
  typed: boolean | null
  /** When the chat's turn ended (ms epoch); null when the host does not say. */
  idleSince: number | null
  /** When the chat's last provider call finished, when known; else `idleSince` is used. */
  lastCallAt: number | null
  cacheWindowMs: number
}

/** What the chat's journal adds. */
export type BoundaryCompactionJournalFacts = {
  /** The newest request of the chat's own agent that is not a command; null when there is none. */
  requestItemId: string | null
  /** A conversation command (such as /compact or /clear) came after that request. */
  commandSinceRequest: boolean
  /** A message waits in the chat's queue. */
  queued: boolean
  /** Context tokens as last measured; null while unknown (as after a compaction). */
  contextTokens: number | null
  /** When that was measured; with the request it names one turn ending. */
  measuredAt: number | null
}

/** The first reason to leave the chat alone, read before its journal is. */
export function boundaryCompactionRestRefusal(
  facts: BoundaryCompactionRestFacts,
  settings: BoundaryCompactionSettings,
  nowMs: number
): BoundaryCompactionRefusal | null {
  if (!facts.compactable) {
    return 'not-compactable'
  }
  if (!facts.awake) {
    return 'asleep'
  }
  if (facts.inTurn || facts.idleSince === null) {
    return 'working'
  }
  if (facts.backgroundRunning) {
    return 'background-work'
  }
  if (facts.paused) {
    return 'paused'
  }
  if (facts.typed === null) {
    return 'typed-unknown'
  }
  if (facts.typed) {
    return 'typed-text'
  }
  const dueAt = boundaryCompactionDueAt(
    {
      idleSince: facts.idleSince,
      lastCallAt: facts.lastCallAt ?? facts.idleSince,
      cacheWindowMs: facts.cacheWindowMs
    },
    settings
  )
  return nowMs < dueAt ? 'not-idle-long-enough' : null
}

/** Names one turn ending, so it is compacted at most once however the attempt went. */
export function boundaryCompactionEndingKey(
  facts: Pick<BoundaryCompactionJournalFacts, 'requestItemId' | 'measuredAt'>
): string {
  return `${facts.requestItemId ?? ''}|${facts.measuredAt ?? ''}`
}

/** The first reason the journal gives to leave the chat alone. */
export function boundaryCompactionJournalRefusal(
  facts: BoundaryCompactionJournalFacts,
  settings: Pick<BoundaryCompactionSettings, 'thresholdTokens'>,
  triedEndingKey: string | undefined
): BoundaryCompactionRefusal | null {
  if (facts.queued) {
    return 'queued-message'
  }
  if (facts.requestItemId === null) {
    return 'no-request'
  }
  if (facts.commandSinceRequest) {
    return 'already-compacted'
  }
  if (facts.contextTokens === null || facts.measuredAt === null) {
    return 'context-unknown'
  }
  if (facts.contextTokens < settings.thresholdTokens) {
    return 'below-threshold'
  }
  return triedEndingKey === boundaryCompactionEndingKey(facts) ? 'already-tried' : null
}

/** Refusals that stay true until the chat takes another turn, so its journal need not be reread. */
export function boundaryCompactionRefusalIsSettled(reason: BoundaryCompactionRefusal): boolean {
  return (
    reason === 'no-request' ||
    reason === 'already-compacted' ||
    reason === 'already-tried' ||
    reason === 'context-unknown' ||
    reason === 'below-threshold'
  )
}

/** Starts the operation id of every compaction this feature sends; the transcript marks its row. */
export const FORK_BOUNDARY_COMPACTION_OPERATION_PREFIX = 'fork-boundary-compact-'

export function forkBoundaryCompactionOperationId(nowMs: number, random: string): string {
  return `${FORK_BOUNDARY_COMPACTION_OPERATION_PREFIX}${String(nowMs).padStart(13, '0')}-${random}`
}

/** True for the transcript row of a compaction this feature sent, read from the row's id. */
export function isForkBoundaryCompactionMessageId(messageId: string): boolean {
  if (!messageId.includes(FORK_BOUNDARY_COMPACTION_OPERATION_PREFIX)) {
    return false
  }
  const identity = parseAgentJournalItemKey(messageId)
  return (
    identity?.provider === 'orca' &&
    identity.clientMessageId.startsWith(FORK_BOUNDARY_COMPACTION_OPERATION_PREFIX)
  )
}

/** Keep only distinct, nonempty strings, at most FORK_BOUNDARY_COMPACTION_MAX_TYPED of them. */
export function normalizeForkBoundaryCompactionTyped(ids: unknown): string[] {
  if (!Array.isArray(ids)) {
    return []
  }
  const kept = new Set<string>()
  for (const id of ids) {
    if (kept.size >= FORK_BOUNDARY_COMPACTION_MAX_TYPED) {
      break
    }
    if (typeof id === 'string' && id.length > 0 && id.length <= 512) {
      kept.add(id)
    }
  }
  return [...kept]
}
