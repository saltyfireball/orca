// Snooze (FORK.md, SLRM-2269): hide a workspace or a chat from the sidebar until a time, until its
// pull request merges, or until it has sat idle for some days. It comes back early when it needs
// an approval or its agent fails, and when the user opens it. The sidebar lives on the client, so
// the snoozes are kept there (in the fork's own JSON file), for local and paired-server workspaces
// alike. This file is the pure part: the shapes, the settings, the presets, the wake labels and
// the wake decision, shared by the desktop, the main process and `orca snooze`.
import { LOCAL_EXECUTION_HOST_ID } from '../execution-host/execution-host'

export type ForkSnoozeTarget =
  | { kind: 'workspace'; worktreeId: string; hostId: string }
  | {
      kind: 'chat'
      /** The chat's or terminal agent's pane key, as the sidebar's agent rows key it. */
      paneKey: string
      worktreeId: string | null
      hostId: string
      sessionId?: string
    }

export type ForkSnoozeUntil =
  | { kind: 'time'; at: number }
  | { kind: 'merge' }
  | { kind: 'idle'; days: number }

export type ForkSnoozeEntry = {
  id: string
  target: ForkSnoozeTarget
  until: ForkSnoozeUntil
  /** The workspace or chat name when it was snoozed, for lists that cannot resolve it. */
  label: string
  snoozedAt: number
  /** Set by a paired device over RPC: it settles without the cleanup command. */
  noCleanup?: boolean
}

/**
 * Why a snooze ended. `merged` and `idle` settle it (the optional cleanup command runs);
 * `attention` (an approval or a question), `failed` and `opened` wake it early.
 */
export type ForkSnoozeWakeReason =
  | 'time'
  | 'merged'
  | 'idle'
  | 'attention'
  | 'failed'
  | 'opened'
  | 'manual'

export const FORK_SNOOZE_SETTLE_REASONS: readonly ForkSnoozeWakeReason[] = ['merged', 'idle']
export const FORK_SNOOZE_MAX_ENTRIES = 500
export const FORK_SNOOZE_MAX_IDLE_DAYS = 365
/** Furthest a timed snooze may reach. */
export const FORK_SNOOZE_MAX_AHEAD_MS = 366 * 24 * 60 * 60_000
const DAY_MS = 24 * 60 * 60_000
const HOUR_MS = 60 * 60_000

export type ForkSnoozeSettings = {
  enabled: boolean
  wakeOnAttention: boolean
  wakeOnFailure: boolean
  wakeOnOpen: boolean
  morningHour: number
  eveningHour: number
  idleDays: number
  settleCommand: string
}

function field(settings: unknown, key: string): unknown {
  return typeof settings === 'object' && settings !== null
    ? (settings as Record<string, unknown>)[key]
    : undefined
}

function hour(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23
    ? value
    : fallback
}

/** Every snooze setting with its default: on, all wake triggers on, 9am, 6pm, 3 days, no command. */
export function readForkSnoozeSettings(settings: unknown): ForkSnoozeSettings {
  const days = field(settings, 'forkSnoozeIdleDays')
  const command = field(settings, 'forkSnoozeSettleCommand')
  return {
    enabled: field(settings, 'forkSnooze') !== false,
    wakeOnAttention: field(settings, 'forkSnoozeWakeOnAttention') !== false,
    wakeOnFailure: field(settings, 'forkSnoozeWakeOnFailure') !== false,
    wakeOnOpen: field(settings, 'forkSnoozeWakeOnOpen') !== false,
    morningHour: hour(field(settings, 'forkSnoozeMorningHour'), 9),
    eveningHour: hour(field(settings, 'forkSnoozeEveningHour'), 18),
    idleDays:
      typeof days === 'number' && Number.isInteger(days) && days >= 1
        ? Math.min(days, FORK_SNOOZE_MAX_IDLE_DAYS)
        : 3,
    settleCommand: typeof command === 'string' ? command.trim().slice(0, 4000) : ''
  }
}

export function forkSnoozeHostId(hostId: string | null | undefined): string {
  return hostId && hostId.length > 0 ? hostId : LOCAL_EXECUTION_HOST_ID
}

/** The sidebar's key for a snoozed workspace: its host and id. */
export function forkSnoozeWorkspaceKey(worktreeId: string, hostId?: string | null): string {
  return `${forkSnoozeHostId(hostId)}\u0000${worktreeId}`
}

/** One snooze per workspace or chat: a new snooze of the same one replaces the old. */
export function forkSnoozeTargetKey(target: ForkSnoozeTarget): string {
  return target.kind === 'workspace'
    ? `workspace\u0000${forkSnoozeWorkspaceKey(target.worktreeId, target.hostId)}`
    : `chat\u0000${target.paneKey}`
}

function atLocal(base: Date, dayOffset: number, hourOfDay: number): number {
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset)
  next.setHours(hourOfDay, 0, 0, 0)
  return next.getTime()
}

export type ForkSnoozePresetId = 'hour' | 'evening' | 'tomorrow' | 'monday'
export type ForkSnoozePreset = { id: ForkSnoozePresetId; at: number }

/** The timed presets. "This evening" is left out once it is less than half an hour away. */
export function forkSnoozePresets(
  now: number,
  hours: Pick<ForkSnoozeSettings, 'morningHour' | 'eveningHour'>
): ForkSnoozePreset[] {
  const today = new Date(now)
  const evening = atLocal(today, 0, hours.eveningHour)
  // Days until the next Monday strictly after today (getDay: 0 is Sunday, 1 is Monday).
  const toMonday = today.getDay() === 1 ? 7 : (8 - today.getDay()) % 7
  return [
    { id: 'hour', at: now + HOUR_MS },
    ...(evening - now >= 30 * 60_000 ? [{ id: 'evening' as const, at: evening }] : []),
    { id: 'tomorrow', at: atLocal(today, 1, hours.morningHour) },
    { id: 'monday', at: atLocal(today, toMonday, hours.morningHour) }
  ]
}

export type ForkSnoozeParse = { ok: true; until: ForkSnoozeUntil } | { ok: false; error: string }

const UNTIL_HELP =
  'Use merge, idle:<days>d, a duration (90m, 2h, 3d, 1w), evening, tomorrow, monday, a time (17:30) or a date and time (2026-11-20T09:00).'

function timed(at: number, now: number): ForkSnoozeParse {
  if (!Number.isFinite(at) || at <= now) {
    return { ok: false, error: 'That time has already passed.' }
  }
  if (at - now > FORK_SNOOZE_MAX_AHEAD_MS) {
    return { ok: false, error: 'Snooze for at most a year.' }
  }
  return { ok: true, until: { kind: 'time', at } }
}

const UNIT_MS: Record<string, number> = { m: 60_000, h: HOUR_MS, d: DAY_MS, w: 7 * DAY_MS }

/** `orca snooze --until`: merge, idle:Nd, a duration, a preset, a clock time or a date and time. */
export function parseForkSnoozeUntil(
  text: string,
  now: number,
  hours: Pick<ForkSnoozeSettings, 'morningHour' | 'eveningHour'>
): ForkSnoozeParse {
  const value = text.trim().toLowerCase()
  if (value === 'merge' || value === 'merged') {
    return { ok: true, until: { kind: 'merge' } }
  }
  const idle = /^idle:(\d{1,3})d?$/.exec(value)
  if (idle) {
    const days = Number(idle[1])
    return days >= 1 && days <= FORK_SNOOZE_MAX_IDLE_DAYS
      ? { ok: true, until: { kind: 'idle', days } }
      : { ok: false, error: `Idle days run from 1 to ${FORK_SNOOZE_MAX_IDLE_DAYS}.` }
  }
  const duration = /^(\d{1,4})(m|h|d|w)$/.exec(value)
  if (duration) {
    return timed(now + Number(duration[1]) * UNIT_MS[duration[2]], now)
  }
  const presets = forkSnoozePresets(now, hours)
  const preset = (id: ForkSnoozePresetId) => presets.find((entry) => entry.id === id)?.at
  if (value === 'evening' || value === 'tonight') {
    const today = new Date(now)
    const at = atLocal(today, 0, hours.eveningHour)
    return timed(at > now ? at : atLocal(today, 1, hours.eveningHour), now)
  }
  if (value === 'tomorrow' || value === 'monday' || value === 'hour') {
    return timed(preset(value) ?? Number.NaN, now)
  }
  const clock = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (clock && Number(clock[1]) <= 23 && Number(clock[2]) <= 59) {
    const today = new Date(now)
    const at = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    at.setHours(Number(clock[1]), Number(clock[2]), 0, 0)
    return timed(at.getTime() > now ? at.getTime() : at.getTime() + DAY_MS, now)
  }
  if (/^\d{4}-\d{2}-\d{2}([t ]\d{1,2}:\d{2})?$/.test(value)) {
    const [day, time = '09:00'] = value.split(/[t ]/)
    const [y, mo, d] = day.split('-').map(Number)
    const [h, mi] = time.split(':').map(Number)
    return timed(new Date(y, mo - 1, d, h, mi, 0, 0).getTime(), now)
  }
  return { ok: false, error: `Cannot read "${text}". ${UNTIL_HELP}` }
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function clockText(date: Date): string {
  const h = date.getHours()
  const minutes = date.getMinutes()
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${minutes === 0 ? '' : `:${String(minutes).padStart(2, '0')}`}${h < 12 ? 'am' : 'pm'}`
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** When a timed snooze ends, short: "6pm", "Mon 9am", "Nov 20 9am". */
export function forkSnoozeTimeText(at: number, now: number): string {
  const date = new Date(at)
  const today = new Date(now)
  if (sameDay(date, today)) {
    return clockText(date)
  }
  if (at - now < 6 * DAY_MS) {
    return `${DAYS[date.getDay()]} ${clockText(date)}`
  }
  return `${MONTHS[date.getMonth()]} ${date.getDate()} ${clockText(date)}`
}

/** The sidebar's and the CLI's wake label: "until 6pm", "until Mon 9am", "until merge". */
export function forkSnoozeWakeLabel(until: ForkSnoozeUntil, now: number): string {
  if (until.kind === 'merge') {
    return 'until merge'
  }
  if (until.kind === 'idle') {
    return `until ${until.days} idle day${until.days === 1 ? '' : 's'}`
  }
  return `until ${forkSnoozeTimeText(until.at, now)}`
}

/** What the desktop knows about a snoozed workspace or chat at one look. */
export type ForkSnoozeFacts = {
  now: number
  /** The user just opened it (it became the active workspace or chat). */
  opened?: boolean
  /** Latest time one of its agents started waiting on an approval or a question. */
  attentionSince?: number | null
  /** Latest time one of its agents failed or errored. */
  failedAt?: number | null
  /** Its pull request is merged. */
  merged?: boolean
  /** Its latest activity. */
  lastActivityAt?: number | null
}

/** Why this snooze ends now, or null while it holds. Only events after the snooze count. */
export function forkSnoozeWakeReason(
  entry: Pick<ForkSnoozeEntry, 'until' | 'snoozedAt'>,
  facts: ForkSnoozeFacts,
  settings: Pick<ForkSnoozeSettings, 'wakeOnAttention' | 'wakeOnFailure' | 'wakeOnOpen'>
): ForkSnoozeWakeReason | null {
  if (settings.wakeOnOpen && facts.opened) {
    return 'opened'
  }
  if (settings.wakeOnAttention && (facts.attentionSince ?? 0) > entry.snoozedAt) {
    return 'attention'
  }
  if (settings.wakeOnFailure && (facts.failedAt ?? 0) > entry.snoozedAt) {
    return 'failed'
  }
  const { until } = entry
  if (until.kind === 'time') {
    return until.at <= facts.now ? 'time' : null
  }
  if (until.kind === 'merge') {
    return facts.merged ? 'merged' : null
  }
  const since = Math.max(entry.snoozedAt, facts.lastActivityAt ?? 0)
  return facts.now - since >= until.days * DAY_MS ? 'idle' : null
}

/** A settle wake must match how the snooze was set: merge settles on merged, idle on idle. */
export function isForkSnoozeSettle(
  until: ForkSnoozeUntil,
  reason: ForkSnoozeWakeReason
): reason is 'merged' | 'idle' {
  return (
    (until.kind === 'merge' && reason === 'merged') || (until.kind === 'idle' && reason === 'idle')
  )
}

/** An id, or a unique id prefix of 4+ characters. */
export function findForkSnoozeEntry(
  entries: readonly ForkSnoozeEntry[],
  query: string
): { ok: true; entry: ForkSnoozeEntry } | { ok: false; error: string } {
  const exact = entries.find((entry) => entry.id === query)
  if (exact) {
    return { ok: true, entry: exact }
  }
  const matches = query.length >= 4 ? entries.filter((entry) => entry.id.startsWith(query)) : []
  if (matches.length === 1) {
    return { ok: true, entry: matches[0] }
  }
  return {
    ok: false,
    error:
      matches.length === 0
        ? `No snooze matches "${query}". Run "orca snooze list".`
        : `"${query}" matches more than one snooze; use more of its id.`
  }
}
