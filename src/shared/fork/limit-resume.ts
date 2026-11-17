// Limit resume (FORK.md, SLRM-2309): its settings, the wait before a resume and the entries the
// sidebar, the Settings card and `orca limits` show. A chat or terminal agent that stops on a
// provider usage limit is parked until the limit resets (or, with no reset given, a backoff
// wait) and then told to go on. Native chats use the stock usage-limit continue, which this
// turns on by default; terminal agents are read and resumed by the fork. Idea from T3 Code's
// "auto-resume when usage limits reset" (MIT); only the idea is ported.
import type { ForkGlobalSettings } from './fork-global-settings'

export const LIMIT_RESUME_DEFAULT_MAX_TRIES = 5
export const LIMIT_RESUME_MIN_MAX_TRIES = 1
export const LIMIT_RESUME_MAX_MAX_TRIES = 20
export const LIMIT_RESUME_DEFAULT_DELAY_SECONDS = 60
export const LIMIT_RESUME_MAX_DELAY_SECONDS = 1800
export const LIMIT_RESUME_DEFAULT_BACKOFF_MINUTES = 30
export const LIMIT_RESUME_MIN_BACKOFF_MINUTES = 5
export const LIMIT_RESUME_MAX_BACKOFF_MINUTES = 240
/** The longest backoff wait, however many tries came before. */
export const LIMIT_RESUME_BACKOFF_CAP_MS = 6 * 60 * 60_000
export const LIMIT_RESUME_DEFAULT_MESSAGE = 'continue'
export const LIMIT_RESUME_MAX_MESSAGE_LENGTH = 500

export type LimitResumeCodexSwitchPrompt = 'dismiss' | 'leave'

export type LimitResumeSettings = {
  enabled: boolean
  terminals: boolean
  maxTries: number
  holdWhileTyping: boolean
  delaySeconds: number
  backoffMinutes: number
  message: string
  codexSwitchPrompt: LimitResumeCodexSwitchPrompt
}

type SettingKey = keyof Pick<
  ForkGlobalSettings,
  | 'forkLimitResume'
  | 'forkLimitResumeTerminals'
  | 'forkLimitResumeMaxTries'
  | 'forkLimitResumeHoldWhileTyping'
  | 'forkLimitResumeDelaySeconds'
  | 'forkLimitResumeBackoffMinutes'
  | 'forkLimitResumeMessage'
  | 'forkLimitResumeCodexSwitchPrompt'
>

/** Any settings object; values are checked here, so a hand-edited file cannot break a reader. */
export type LimitResumeSettingsSource = Partial<Record<SettingKey, unknown>> | null | undefined

function int(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback
}

/** Control, line-break and bidi characters: typed into a terminal they act as keys or hide text. */
// oxlint-disable-next-line no-control-regex -- refusing control characters is the point
const UNSAFE_MESSAGE_CHARS = /[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/

/** One line of plain text, or the default. */
function message(value: unknown): string {
  if (typeof value !== 'string') {
    return LIMIT_RESUME_DEFAULT_MESSAGE
  }
  const text = value.trim()
  return text.length === 0 ||
    text.length > LIMIT_RESUME_MAX_MESSAGE_LENGTH ||
    UNSAFE_MESSAGE_CHARS.test(text)
    ? LIMIT_RESUME_DEFAULT_MESSAGE
    : text
}

export function readLimitResumeSettings(settings: LimitResumeSettingsSource): LimitResumeSettings {
  return {
    enabled: settings?.forkLimitResume !== false,
    terminals: settings?.forkLimitResumeTerminals !== false,
    maxTries: int(
      settings?.forkLimitResumeMaxTries,
      LIMIT_RESUME_MIN_MAX_TRIES,
      LIMIT_RESUME_MAX_MAX_TRIES,
      LIMIT_RESUME_DEFAULT_MAX_TRIES
    ),
    holdWhileTyping: settings?.forkLimitResumeHoldWhileTyping !== false,
    delaySeconds: int(
      settings?.forkLimitResumeDelaySeconds,
      0,
      LIMIT_RESUME_MAX_DELAY_SECONDS,
      LIMIT_RESUME_DEFAULT_DELAY_SECONDS
    ),
    backoffMinutes: int(
      settings?.forkLimitResumeBackoffMinutes,
      LIMIT_RESUME_MIN_BACKOFF_MINUTES,
      LIMIT_RESUME_MAX_BACKOFF_MINUTES,
      LIMIT_RESUME_DEFAULT_BACKOFF_MINUTES
    ),
    message: message(settings?.forkLimitResumeMessage),
    codexSwitchPrompt: settings?.forkLimitResumeCodexSwitchPrompt === 'leave' ? 'leave' : 'dismiss'
  }
}

/** The stock native-chat continue is on when its own toggle is, or when this feature is. */
export function limitResumeNativeContinueOn(settings: unknown): boolean {
  const source = (typeof settings === 'object' && settings !== null ? settings : {}) as {
    nativeChatAutoContinueAfterUsageLimit?: unknown
  } & NonNullable<LimitResumeSettingsSource>
  return (
    source.nativeChatAutoContinueAfterUsageLimit === true || readLimitResumeSettings(source).enabled
  )
}

/** Whether windows should report which native chats hold a draft for this feature. */
export function limitResumeWatchesDrafts(settings: unknown): boolean {
  const read = readLimitResumeSettings(
    typeof settings === 'object' && settings !== null
      ? (settings as LimitResumeSettingsSource)
      : null
  )
  return read.enabled && read.holdWhileTyping
}

/**
 * When a parked agent is told to go on: the reset plus the delay, or with no reset a backoff
 * wait that doubles with each resume already made in this streak, up to six hours.
 */
export function limitResumeAt(
  input: { resetsAt: number | null; detectedAt: number; tries: number },
  settings: Pick<LimitResumeSettings, 'delaySeconds' | 'backoffMinutes'>
): number {
  if (input.resetsAt !== null) {
    return Math.max(input.resetsAt, input.detectedAt) + settings.delaySeconds * 1000
  }
  const wait = settings.backoffMinutes * 60_000 * 2 ** Math.min(Math.max(0, input.tries), 10)
  return input.detectedAt + Math.min(wait, LIMIT_RESUME_BACKOFF_CAP_MS)
}

/**
 * - parked: waiting for its time.
 * - held: its time came, but someone is typing there (or its screen cannot be read).
 * - exhausted: it has had the most resumes in a row; it waits for you.
 * - cancelled: you said not to resume it.
 */
export type LimitResumeState = 'parked' | 'held' | 'exhausted' | 'cancelled'

export type LimitResumeEntry = {
  /** A terminal agent's pane key, or `chat:<session id>` for a native chat. */
  id: string
  kind: 'terminal' | 'chat'
  paneKey: string
  sessionId?: string
  worktreeId: string | null
  agent: string
  title: string
  /** Epoch ms the provider named, or null when it named none. */
  resetsAt: number | null
  /** Epoch ms of the next resume. */
  resumeAt: number
  tries: number
  maxTries: number
  state: LimitResumeState
  /** The provider's own words, cut to one line. */
  line: string
}

const STATES: readonly LimitResumeState[] = ['parked', 'held', 'exhausted', 'cancelled']
const MAX_ENTRIES = 500

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** What crossed IPC, checked field by field; anything malformed is dropped. */
export function normalizeLimitResumeEntries(value: unknown): LimitResumeEntry[] {
  if (!Array.isArray(value)) {
    return []
  }
  const kept: LimitResumeEntry[] = []
  for (const raw of value.slice(0, MAX_ENTRIES)) {
    if (typeof raw !== 'object' || raw === null) {
      continue
    }
    const entry = raw as Record<string, unknown>
    const id = text(entry.id, 600)
    const paneKey = text(entry.paneKey, 600)
    const resumeAt = finite(entry.resumeAt)
    const state = STATES.find((known) => known === entry.state)
    if (!id || !paneKey || resumeAt === null || !state) {
      continue
    }
    const sessionId = text(entry.sessionId, 512)
    kept.push({
      id,
      kind: entry.kind === 'chat' ? 'chat' : 'terminal',
      paneKey,
      ...(sessionId ? { sessionId } : {}),
      worktreeId: text(entry.worktreeId, 512),
      agent: text(entry.agent, 64) ?? '',
      title: text(entry.title, 512) ?? '',
      resetsAt: finite(entry.resetsAt),
      resumeAt,
      tries: finite(entry.tries) ?? 0,
      maxTries: finite(entry.maxTries) ?? LIMIT_RESUME_DEFAULT_MAX_TRIES,
      state,
      line: text(entry.line, 1000) ?? ''
    })
  }
  return kept
}

/** "HH:MM" today, else a short day and time, in the reader's own clock. */
export function formatLimitResumeClock(at: number, now: number, locale?: string): string {
  const date = new Date(at)
  const today = date.toDateString() === new Date(now).toDateString()
  return new Intl.DateTimeFormat(
    locale,
    today
      ? { hour: '2-digit', minute: '2-digit' }
      : { weekday: 'short', hour: '2-digit', minute: '2-digit' }
  ).format(date)
}
