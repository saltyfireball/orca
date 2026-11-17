// Limit resume (FORK.md, SLRM-2309): reads a terminal agent's screen for a usage-limit stop and the
// reset time the provider printed. Plain text only: no process is read and nothing is written.
// Claude Code prints, for example:
//   "You've hit your session limit - resets 3:45pm (America/New_York)"
//   "5-hour limit reached - resets 3pm"
//   "Claude usage limit reached. Your limit will reset at 3pm (America/New_York)."
//   "Usage limit reached - continuing automatically at 3:45pm - esc to cancel" (it goes on itself)
// (the dashes stand for the middle dots and bullets Claude Code prints between the parts)
// Codex prints "You've hit your usage limit. ... try again at 3:45 PM." (or "in 2 hours 5
// minutes"), and between turns may hold the pane on its "Approaching rate limits" menu.

/** Only the bottom of the screen counts: an old stop further up was answered long ago. */
export const LIMIT_SCREEN_TAIL_LINES = 24
/** A reset further out than this is not one to wait for; the backoff is used instead. */
const MAX_RESET_AHEAD_MS = 8 * 24 * 60 * 60_000

export type LimitScreenRead =
  | { kind: 'none' }
  | {
      kind: 'limit'
      /** The provider's line, trimmed, as found on screen. */
      line: string
      /** How many times that exact line is on screen; a fresh stop with the same words adds one. */
      occurrences: number
      resetsAt: number | null
      /** The agent said it will go on by itself (Claude Code's own auto-continue). */
      selfContinue: boolean
    }
  | { kind: 'codex-switch-prompt' }

const CLAUDE_HIT =
  /\b(?:you'?ve|you have) hit your (?:(?:session|weekly|opus|sonnet|5-hour|five-hour|daily)\s+)?limit\b/i
const LIMIT_REACHED =
  /\b(?:5-hour|five-hour|session|weekly|opus|sonnet|daily|usage) limit reached\b/i
const CODEX_HIT = /\b(?:you'?ve|you have) hit your usage limit\b/i
/** Limits no clock lifts: spend caps, credits and a workspace owner's say. */
const NO_RESET =
  /request a limit increase|out of credits|ask your (?:workspace )?(?:owner|admin)|spend limit|budget/i
const TRANSIENT = /wrapping up/i
const SELF_CONTINUE = /continuing automatically at\s+(.+?)(?:\s*[\u00b7\u2219\u2022|]|$)/i
const RESETS = /\bresets?\s+(?:at\s+|on\s+)?(.+?)(?:\s*[\u00b7\u2219\u2022|]|$)/i
const TRY_AGAIN = /\btry again (at|in)\s+(.+?)(?:\.(?:\s|$)|$)/i

const SWITCH_TITLE = /approaching rate limits/i
const SWITCH_OPTION = /keep current model/i

function clean(line: string): string {
  // oxlint-disable-next-line no-control-regex -- terminal escapes are stripped on purpose
  return line.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').trim()
}

function isLimitLine(line: string): boolean {
  return CLAUDE_HIT.test(line) || LIMIT_REACHED.test(line) || CODEX_HIT.test(line)
}

/** Reads the bottom of a screen. `lines` is the screen top to bottom, as the terminal shows it. */
export function readLimitScreen(
  lines: readonly string[],
  now: number,
  timeZone?: string
): LimitScreenRead {
  const all = lines.map(clean)
  const tail: number[] = []
  for (let index = all.length - 1; index >= 0 && tail.length < LIMIT_SCREEN_TAIL_LINES; index--) {
    if (all[index]) {
      tail.unshift(index)
    }
  }
  const tailText = tail.map((index) => all[index]).join('\n')
  if (SWITCH_TITLE.test(tailText) && SWITCH_OPTION.test(tailText)) {
    return { kind: 'codex-switch-prompt' }
  }
  for (let at = tail.length - 1; at >= 0; at--) {
    const index = tail[at]
    const line = all[index]
    if (!isLimitLine(line) || TRANSIENT.test(line)) {
      continue
    }
    // A long message wraps: read on until a blank row, at most three more rows.
    const joined = [line]
    for (let next = index + 1; next < all.length && next <= index + 3 && all[next]; next++) {
      joined.push(all[next])
    }
    const words = joined.join(' ')
    // The line's own words first: a wrapped row after it may hold unrelated text.
    const find = (pattern: RegExp): RegExpExecArray | null =>
      pattern.exec(line) ?? pattern.exec(words)
    const self = find(SELF_CONTINUE)
    const resetText = self?.[1] ?? find(RESETS)?.[1] ?? null
    const tryAgain = find(TRY_AGAIN)
    const resetsAt = tryAgain
      ? tryAgain[1].toLowerCase() === 'in'
        ? parseLimitDuration(tryAgain[2], now)
        : parseLimitResetClock(tryAgain[2], now, timeZone)
      : resetText
        ? parseLimitResetClock(resetText, now, timeZone)
        : null
    if (resetsAt === null && NO_RESET.test(words)) {
      return { kind: 'none' }
    }
    return {
      kind: 'limit',
      line,
      occurrences: all.filter((row) => row === line).length,
      resetsAt,
      selfContinue: self !== null
    }
  }
  return { kind: 'none' }
}

const UNITS: Record<string, number> = {
  d: 86_400_000,
  h: 3_600_000,
  m: 60_000,
  s: 1000
}

/** "2 hours 5 minutes", "45 seconds", "less than a minute": epoch ms from now, or null. */
export function parseLimitDuration(text: string, now: number): number | null {
  if (/less than a minute/i.test(text)) {
    return now + 60_000
  }
  let total = 0
  let found = false
  for (const match of text.matchAll(
    /(\d+(?:\.\d+)?)\s*(day|hour|hr|minute|min|second|sec|d|h|m|s)\w*/gi
  )) {
    const unit = match[2].toLowerCase()
    const key = unit.startsWith('mi') || unit === 'm' ? 'm' : unit[0]
    total += Number(match[1]) * (UNITS[key] ?? 0)
    found = true
  }
  return found && total > 0 && total <= MAX_RESET_AHEAD_MS ? now + total : null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

type Wall = { year: number; month: number; day: number; hour: number; minute: number }

/** The wall clock of `at` in a zone (or this machine's own when none). */
function wallOf(at: number, timeZone: string | undefined): Wall & { weekday: number } {
  if (!timeZone) {
    const date = new Date(at)
    return {
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      weekday: date.getDay()
    }
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short'
  }).formatToParts(new Date(at))
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
  return {
    year: Number(part('year')),
    month: Number(part('month')) - 1,
    day: Number(part('day')),
    hour: Number(part('hour')) % 24,
    minute: Number(part('minute')),
    weekday: DAYS.indexOf(part('weekday').slice(0, 3).toLowerCase())
  }
}

/** Epoch ms of a wall clock in a zone (or this machine's own). */
function epochOf(wall: Wall, timeZone: string | undefined): number {
  if (!timeZone) {
    return new Date(wall.year, wall.month, wall.day, wall.hour, wall.minute).getTime()
  }
  const asUtc = Date.UTC(wall.year, wall.month, wall.day, wall.hour, wall.minute)
  let guess = asUtc
  // Two passes settle the zone's offset, also across a daylight-saving change.
  for (let pass = 0; pass < 2; pass++) {
    const seen = wallOf(guess, timeZone)
    const seenUtc = Date.UTC(seen.year, seen.month, seen.day, seen.hour, seen.minute)
    guess += asUtc - seenUtc
  }
  return guess
}

function validZone(zone: string | undefined): string | undefined {
  if (!zone) {
    return undefined
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return zone
  } catch {
    return undefined
  }
}

const MONTH_DAY =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b,?\s*(?:(\d{4})\b)?/i
const WEEKDAY =
  /\b(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)\b\.?/i

const CLOCK = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m?\.?\b|(\d{1,2}):(\d{2})/i

function clockOf(text: string): { hour: number; minute: number } | null {
  const match = CLOCK.exec(text)
  if (!match) {
    return null
  }
  if (match[4] !== undefined) {
    const hour = Number(match[4])
    const minute = Number(match[5])
    return hour < 24 && minute < 60 ? { hour, minute } : null
  }
  const raw = Number(match[1])
  const minute = match[2] === undefined ? 0 : Number(match[2])
  if (raw < 1 || raw > 12 || minute > 59) {
    return null
  }
  const pm = match[3].toLowerCase() === 'p'
  return { hour: (raw % 12) + (pm ? 12 : 0), minute }
}

/**
 * "3pm", "3:45 PM", "Mon 12:00am", "Oct 9, 2pm", "Jan 1st, 2027 1:00 PM", "2026-08-09 00:00 UTC",
 * each with an optional "(Area/City)" zone: epoch ms of the next such moment, or null.
 */
export function parseLimitResetClock(
  raw: string,
  now: number,
  machineZone?: string
): number | null {
  const zoneMatch = /\(([A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+|UTC)\)/.exec(raw)
  const iso = /(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?:\s*(UTC|Z|GMT))?/i.exec(raw)
  let zone = validZone(zoneMatch?.[1]) ?? validZone(machineZone)
  const text = raw.replace(/\([^)]*\)/g, ' ').trim()
  let at: number | null = null
  if (iso) {
    zone = iso[6] ? 'UTC' : zone
    const [year, month, day, hour, minute] = iso.slice(1, 6).map(Number)
    at = epochOf({ year, month: month - 1, day, hour, minute }, zone)
  } else {
    const clock = clockOf(text)
    if (!clock) {
      return null
    }
    const today = wallOf(now, zone)
    const monthDay = MONTH_DAY.exec(text)
    const weekday = WEEKDAY.exec(text)
    if (monthDay) {
      const month = MONTHS.indexOf(monthDay[1].slice(0, 3).toLowerCase())
      const day = Number(monthDay[2])
      const explicitYear = monthDay[3] ? Number(monthDay[3]) : null
      at = epochOf({ year: explicitYear ?? today.year, month, day, ...clock }, zone)
      if (explicitYear === null && at < now - 86_400_000) {
        at = epochOf({ year: today.year + 1, month, day, ...clock }, zone)
      }
    } else {
      // Days are added on the wall clock, so a daylight-saving change keeps the hour.
      const onDay = (ahead: number): number =>
        epochOf({ ...today, day: today.day + ahead, ...clock }, zone)
      if (weekday) {
        const ahead = (DAYS.indexOf(weekday[1].slice(0, 3).toLowerCase()) - today.weekday + 7) % 7
        at = onDay(ahead)
        if (at < now - 60_000) {
          at = onDay(ahead + 7)
        }
      } else {
        at = onDay(0)
        if (at < now - 60_000) {
          at = onDay(1)
        }
      }
    }
  }
  return at !== null &&
    Number.isFinite(at) &&
    at > now - 5 * 60_000 &&
    at - now <= MAX_RESET_AHEAD_MS
    ? at
    : null
}
