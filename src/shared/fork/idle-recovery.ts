// Idle recovery (FORK.md). After an agent's turn ends and its chat sits idle, the ending is
// classified once as finished, waiting on the user, or stalled (work it offered or promised and
// could do now). Stalled chats may be woken with a message; chats waiting on the user are listed
// in the Decision inbox. This file is the contract with the classifier command and the pure
// rules; nothing here runs unless `forkIdleSweepMode` is not 'off'.

export const IDLE_RECOVERY_INPUT_VERSION = 1
/** The classifier sees at most this much of the end of the last assistant message. */
export const IDLE_RECOVERY_MESSAGE_TAIL_CHARS = 8000
const MAX_REASON_CHARS = 500
const MAX_QUESTION_CHARS = 2000
const MAX_NEXT_STEP_CHARS = 2000

export type IdleRecoveryVerdictKind = 'finished' | 'waiting_user' | 'stalled'
export type IdleRecoveryChatKind = 'chat' | 'terminal'
/** Who asked for the turn that ended. `wake` is a turn idle recovery itself started. */
export type IdleRecoveryRequestSource = 'user' | 'orchestration' | 'automation' | 'wake'
export type IdleRecoveryRole = 'standalone' | 'worker' | 'coordinator'

/** What the classifier command reads on stdin, as one JSON object. */
export type IdleRecoveryClassifierInput = {
  version: typeof IDLE_RECOVERY_INPUT_VERSION
  chat: { id: string; kind: IdleRecoveryChatKind; agent: string; cwd: string; title: string }
  request_source: IdleRecoveryRequestSource
  role: IdleRecoveryRole
  last_user_request: string
  last_assistant_message: string
  idle_seconds: number
  background_pending: boolean
  scheduled_wake: boolean
  wakes_this_turn: number
  max_wakes: number
}

/** The classifier's answer, parsed from the JSON object it prints on stdout. */
export type IdleRecoveryVerdict = {
  verdict: IdleRecoveryVerdictKind
  reason: string
  /** waiting_user: what the user is asked. */
  question: string
  /** stalled: the work the wake message asks for. */
  nextStep: string
  /** Seconds to wait before the wake or the next look; 0 is now. */
  wakeAfterSeconds: number
}

const VERDICTS: readonly string[] = ['finished', 'waiting_user', 'stalled']

function isVerdictKind(value: unknown): value is IdleRecoveryVerdictKind {
  return typeof value === 'string' && VERDICTS.includes(value)
}

function finished(reason: string): IdleRecoveryVerdict {
  return { verdict: 'finished', reason, question: '', nextStep: '', wakeAfterSeconds: 0 }
}

export function tailForIdleRecoveryClassifier(message: string): string {
  return message.length > IDLE_RECOVERY_MESSAGE_TAIL_CHARS
    ? message.slice(-IDLE_RECOVERY_MESSAGE_TAIL_CHARS)
    : message
}

/**
 * Reads a classifier's stdout. Anything but one JSON object with every field of the right type
 * reads as `finished`, so a broken classifier never wakes a chat or fills the inbox.
 */
export function parseIdleRecoveryVerdict(
  stdout: string,
  recheckMaxSeconds: number
): IdleRecoveryVerdict {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return finished('classifier output was not JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return finished('classifier output was not a JSON object')
  }
  const verdict = 'verdict' in parsed ? parsed.verdict : undefined
  const reason = 'reason' in parsed ? parsed.reason : undefined
  const question = 'question' in parsed ? parsed.question : undefined
  const nextStep = 'next_step' in parsed ? parsed.next_step : undefined
  const wakeAfter = 'wake_after_seconds' in parsed ? parsed.wake_after_seconds : undefined
  if (!isVerdictKind(verdict)) {
    return finished('classifier gave an unknown verdict')
  }
  if (
    typeof reason !== 'string' ||
    typeof question !== 'string' ||
    typeof nextStep !== 'string' ||
    typeof wakeAfter !== 'number' ||
    !Number.isFinite(wakeAfter)
  ) {
    return finished('classifier output is missing a field')
  }
  const ceiling = Math.max(0, Math.floor(recheckMaxSeconds))
  return {
    verdict,
    reason: reason.slice(0, MAX_REASON_CHARS),
    question: question.slice(0, MAX_QUESTION_CHARS),
    nextStep: nextStep.slice(0, MAX_NEXT_STEP_CHARS),
    wakeAfterSeconds: Math.min(ceiling, Math.max(0, Math.round(wakeAfter)))
  }
}

export type IdleRecoveryWakeFacts = {
  wakesThisTurn: number
  maxWakes: number
  requestSource: IdleRecoveryRequestSource
  role: IdleRecoveryRole
  /** The `forkIdleSweepWorkers` setting. */
  workers: 'skip' | 'include'
  paused: boolean
  backgroundPending: boolean
  scheduledWake: boolean
  /** A coordinator with open dispatches or live children: its workers will report to it. */
  coordinatorBusy: boolean
}

/** Why a stalled chat is not woken for this ending at all. */
export type IdleRecoveryNeverReason = 'request-source' | 'worker' | 'wake-budget'
/** Why a stalled chat is not woken now; the next sweep asks again. */
export type IdleRecoveryHoldReason =
  | 'paused'
  | 'coordinator-busy'
  | 'background-pending'
  | 'scheduled-wake'

export type IdleRecoveryWakeDecision =
  | { action: 'wake' }
  | { action: 'hold'; reason: IdleRecoveryHoldReason }
  | { action: 'never'; reason: IdleRecoveryNeverReason }

/**
 * Whether a chat judged stalled may be sent a wake message. Only turns the user asked for (or
 * an earlier wake of one) are woken; orchestration and automation turns have their own owners.
 */
export function decideIdleRecoveryWake(facts: IdleRecoveryWakeFacts): IdleRecoveryWakeDecision {
  if (facts.requestSource !== 'user' && facts.requestSource !== 'wake') {
    return { action: 'never', reason: 'request-source' }
  }
  if (facts.role === 'worker' && facts.workers !== 'include') {
    return { action: 'never', reason: 'worker' }
  }
  if (facts.wakesThisTurn >= facts.maxWakes) {
    return { action: 'never', reason: 'wake-budget' }
  }
  if (facts.paused) {
    return { action: 'hold', reason: 'paused' }
  }
  if (facts.role === 'coordinator' && facts.coordinatorBusy) {
    return { action: 'hold', reason: 'coordinator-busy' }
  }
  if (facts.backgroundPending) {
    return { action: 'hold', reason: 'background-pending' }
  }
  if (facts.scheduledWake) {
    return { action: 'hold', reason: 'scheduled-wake' }
  }
  return { action: 'wake' }
}

/**
 * The first line of every wake message. A turn whose prompt starts with it was started by idle
 * recovery, and a chat's wake count resets once its prompt no longer starts with it.
 */
export const IDLE_RECOVERY_WAKE_MARKER = '[idle-recovery: automatic wake]'

export function isWakePrompt(text: string | null | undefined): boolean {
  return typeof text === 'string' && text.trimStart().startsWith(IDLE_RECOVERY_WAKE_MARKER)
}

export function buildIdleRecoveryWakeMessage(body: string): string {
  return `${IDLE_RECOVERY_WAKE_MARKER}\n${body.trim()}`
}

function fnv1a32(value: string, seed: number): number {
  let hash = seed >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x0100_0193) >>> 0
  }
  return hash
}

/**
 * Names one ending of one chat, so each ending is classified once. The chat id's length goes
 * in so that ('ab', 'c') and ('a', 'bc') differ.
 */
export function idleRecoveryEndingFingerprint(chatId: string, endingText: string): string {
  const value = `${chatId.length}:${chatId}${endingText}`
  const head = fnv1a32(value, 0x811c_9dc5).toString(16).padStart(8, '0')
  const tail = fnv1a32(value, 0x0100_0193).toString(16).padStart(8, '0')
  return `${head}${tail}`
}

/**
 * What is remembered per chat between sweeps and across restarts: the verdict on its ending, and
 * what the inbox and a later wake need without reading the chat again.
 */
export type IdleRecoveryChatState = {
  /** `idleRecoveryEndingFingerprint` of the ending this row describes. */
  fingerprint: string
  verdict: IdleRecoveryVerdictKind
  /** The classifier's question for a waiting_user ending, else empty. */
  question: string
  /** The classifier's reason, shown in the inbox. */
  reason: string
  /** The classifier's next step for a stalled ending, kept for a wake that is sent later. */
  nextStep: string
  /** Epoch ms when this ending was first classified. */
  since: number
  /** Wake messages sent since the last prompt that was not a wake. */
  wakes: number
  /** Epoch ms of the next wake or look, or null when none is due. */
  wakeAt: number | null
  paused: boolean
  /** Epoch ms the chat went idle when its ending was last read: unchanged means same ending. */
  idleSince: number
  /** Epoch ms the chat was last among the candidates. */
  seenAt: number
  /** False once the chat is no longer idle (or was just woken): kept for its wake count only. */
  listed: boolean
  kind: IdleRecoveryChatKind
  agent: string
  title: string
  workspace: string
  worktreeId: string | null
}

export const IDLE_RECOVERY_STATE_VERSION = 1

export type IdleRecoveryPersistedState = {
  version: typeof IDLE_RECOVERY_STATE_VERSION
  /** Keyed by chat id: a native chat session id or a terminal agent pane key. */
  chats: Record<string, IdleRecoveryChatState>
}
