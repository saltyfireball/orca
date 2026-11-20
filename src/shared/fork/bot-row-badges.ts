// Bot row status badges and per-bot color (FORK.md "Bot row badges and colors"). Pure: the state
// a bot row reads as, from counts the row already holds, and the stored color choice.
import type { ForkGlobalSettings } from './fork-global-settings'

export type ForkBotRowBadgeSettings = {
  /** Fork (BAD-658): count badges for what needs you and what is working on a bot's sidebar row, an idle look, and the folded header's total; unset is on. */
  forkBotRowBadges?: boolean
  /** Fork (BAD-658): a color per bot row, keyed by `<host>/<bot id>`, as a `#rrggbb` hex; a bot with none looks as before. */
  forkBotRowColors?: Record<string, string>
}

type BadgeSettings = Pick<ForkGlobalSettings, 'forkBotRowBadges' | 'forkBotRowColors'>

export function forkBotRowBadgesEnabled(settings: BadgeSettings | null | undefined): boolean {
  return settings?.forkBotRowBadges !== false
}

/** The picker's palette: mid-tone colors that read on the light and the dark theme. */
export const FORK_BOT_ROW_PALETTE = [
  { id: 'red', hex: '#ef4444' },
  { id: 'orange', hex: '#f97316' },
  { id: 'yellow', hex: '#eab308' },
  { id: 'green', hex: '#22c55e' },
  { id: 'teal', hex: '#14b8a6' },
  { id: 'blue', hex: '#3b82f6' },
  { id: 'purple', hex: '#a855f7' },
  { id: 'pink', hex: '#ec4899' }
] as const

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** A `#rrggbb` color for a stored value, or null when it is not a hex color. */
export function normalizeForkBotRowColor(value: unknown): string | null {
  if (typeof value !== 'string' || !HEX_RE.test(value)) {
    return null
  }
  const hex = value.slice(1).toLowerCase()
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex}`
}

/** The bot's chosen color; null (no tint) when unset or not a hex. */
export function forkBotRowColor(
  settings: BadgeSettings | null | undefined,
  botKey: string
): string | null {
  const colors = settings?.forkBotRowColors
  return colors && Object.hasOwn(colors, botKey) ? normalizeForkBotRowColor(colors[botKey]) : null
}

/** The settings write for a bot's color; null clears it, and the map stays free of empty entries. */
export function forkBotRowColorsWith(
  colors: Record<string, string> | undefined,
  botKey: string,
  color: string | null
): Record<string, string> {
  const next = { ...colors }
  const hex = normalizeForkBotRowColor(color)
  if (hex) {
    next[botKey] = hex
  } else {
    delete next[botKey]
  }
  return next
}

export type ForkBotRowCountInput = {
  /** Its agent rows (not sub-agents) stopped on a question or approval. */
  rowsAsking: number
  /** Its agent rows working, not counting those asking. */
  rowsWorking: number
  /** Its workers' workspaces stopped on a permission, and working. */
  workerPermission: number
  workerWorking: number
  /** The Needs you count the bot's panel or Items badge publishes, where one is mounted. */
  published: number | null
  /** Else the items its host's list counted. */
  listedItems: number | null
  /** Its own turn shows as working although no row says so (a terminal pane's title). */
  homeWorking: boolean
}

export type ForkBotRowCounts = { needsYou: number; working: number }

/** The counts behind "N needs you" and "N working": the same fallback the row's line reads. */
export function forkBotRowCounts(input: ForkBotRowCountInput): ForkBotRowCounts {
  const needsYou =
    input.published ??
    input.rowsAsking + input.workerPermission + Math.max(0, input.listedItems ?? 0)
  const counted = input.rowsWorking + input.workerWorking
  return { needsYou, working: counted === 0 && input.homeWorking ? 1 : counted }
}

export type ForkBotRowState = 'offline' | 'paused' | 'stopped' | 'needsYou' | 'working' | 'idle'

/** What the row reads as, first match: offline, paused, stopped on a usage limit, needs you, working, else idle. */
export function forkBotRowState(input: {
  offline: boolean
  paused: boolean
  stopped: boolean
  counts: ForkBotRowCounts
}): ForkBotRowState {
  if (input.offline) {
    return 'offline'
  }
  if (input.paused) {
    return 'paused'
  }
  if (input.counts.needsYou > 0) {
    return 'needsYou'
  }
  if (input.stopped) {
    return 'stopped'
  }
  return input.counts.working > 0 ? 'working' : 'idle'
}

/** The row's tint: a 2px left edge bar and a faint wash, and the avatar ring's color. */
export function forkBotRowColorStyle(color: string): {
  boxShadow: string
  backgroundColor: string
} {
  return {
    boxShadow: `inset 2px 0 0 ${color}`,
    backgroundColor: `color-mix(in srgb, ${color} 8%, transparent)`
  }
}
