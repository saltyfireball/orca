// Agent state colors (FORK.md). An optional color on a tab and its sidebar agent row that
// follows the agent's state. It reads the state the app already shows (the row's and tab's
// state glyph, the unread mark, and the fork's stalled, queued and asleep marks); it never
// derives a state of its own. A manual tab color always wins. Off unless `forkAgentStateColors`.
import type { ForkGlobalSettings } from './fork-global-settings'

/** The colorable states, in precedence order: the first that applies is the one shown. */
export const FORK_AGENT_COLOR_STATES = [
  'needsYou',
  'stalled',
  'working',
  'queued',
  'unread',
  'done',
  'asleep'
] as const
export type ForkAgentColorState = (typeof FORK_AGENT_COLOR_STATES)[number]

export type ForkAgentStateColorWhere = 'both' | 'tab' | 'row'
export type ForkAgentStateColorStrength = 'accent' | 'tint'

/**
 * Theme color choices. Each is a CSS variable the stock light and dark themes define and the
 * custom app theme importer also writes from a pasted palette, so a color follows the theme.
 */
export const FORK_AGENT_THEME_COLORS = {
  blue: 'var(--text-link, var(--color-blue-500))',
  yellow: 'var(--git-decoration-modified)',
  green: 'var(--git-decoration-added)',
  red: 'var(--git-decoration-deleted)',
  accent: 'var(--primary)',
  muted: 'var(--muted-foreground)'
} as const
export type ForkAgentThemeColor = keyof typeof FORK_AGENT_THEME_COLORS
export const FORK_AGENT_THEME_COLOR_IDS = Object.keys(
  FORK_AGENT_THEME_COLORS
) as ForkAgentThemeColor[]

/** A stored choice: 'none', a theme color id, or a `#rgb` / `#rrggbb` custom color. */
export type ForkAgentColorChoice = 'none' | ForkAgentThemeColor | (string & {})

export const FORK_AGENT_STATE_COLOR_DEFAULTS: Readonly<
  Record<ForkAgentColorState, ForkAgentColorChoice>
> = {
  needsYou: 'yellow',
  stalled: 'red',
  working: 'blue',
  queued: 'muted',
  unread: 'accent',
  done: 'green',
  asleep: 'none'
}

/** Alpha of the tinted background, as a percent of the state color. */
export const FORK_AGENT_STATE_TINT_PERCENT = 14

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

type StateColorSettings = Pick<
  ForkGlobalSettings,
  | 'forkAgentStateColors'
  | 'forkAgentStateColorsWhere'
  | 'forkAgentStateColorsStrength'
  | 'forkAgentStateColorsByState'
>

export function forkAgentStateColorsEnabled(
  settings: StateColorSettings | null | undefined
): boolean {
  return settings?.forkAgentStateColors === true
}

/** Unset or unknown reads as both. */
export function forkAgentStateColorsWhere(
  settings: StateColorSettings | null | undefined
): ForkAgentStateColorWhere {
  const where = settings?.forkAgentStateColorsWhere
  return where === 'tab' || where === 'row' ? where : 'both'
}

/** Unset or unknown reads as the subtle accent. */
export function forkAgentStateColorsStrength(
  settings: StateColorSettings | null | undefined
): ForkAgentStateColorStrength {
  return settings?.forkAgentStateColorsStrength === 'tint' ? 'tint' : 'accent'
}

/** True when the feature is on and shows on this surface. */
export function forkAgentStateColorsShowOn(
  settings: StateColorSettings | null | undefined,
  surface: 'tab' | 'row'
): boolean {
  if (!forkAgentStateColorsEnabled(settings)) {
    return false
  }
  const where = forkAgentStateColorsWhere(settings)
  return where === 'both' || where === surface
}

/** The stored choice for a state; anything not 'none', a theme id or a hex is the default. */
export function forkAgentStateColorChoice(
  settings: StateColorSettings | null | undefined,
  state: ForkAgentColorState
): ForkAgentColorChoice {
  const stored = settings?.forkAgentStateColorsByState?.[state]
  return isForkAgentColorChoice(stored) ? stored : FORK_AGENT_STATE_COLOR_DEFAULTS[state]
}

/** Own keys only, so `constructor` and friends are not colors. */
function isThemeColor(value: string): value is ForkAgentThemeColor {
  return Object.hasOwn(FORK_AGENT_THEME_COLORS, value)
}

export function isForkAgentColorChoice(value: unknown): value is ForkAgentColorChoice {
  return (
    typeof value === 'string' &&
    (value === 'none' || isThemeColor(value) || HEX_COLOR_RE.test(value))
  )
}

/** The CSS color a choice paints, or null for 'none' (and anything invalid). */
export function forkAgentColorChoiceCss(choice: ForkAgentColorChoice | undefined): string | null {
  if (!choice || choice === 'none') {
    return null
  }
  if (isThemeColor(choice)) {
    return FORK_AGENT_THEME_COLORS[choice]
  }
  return HEX_COLOR_RE.test(choice) ? choice.toLowerCase() : null
}

/**
 * The state glyph the app already shows, in AgentStateDot's vocabulary. Kept as plain strings
 * so this shared module does not import the renderer's type.
 */
export type ForkAgentStateInput = {
  /** The row's or tab's state glyph, or null when it shows none. */
  dotState: string | null | undefined
  unread?: boolean
  stalled?: boolean
  queued?: boolean
  asleep?: boolean
}

/** Which colorable state applies, first match in FORK_AGENT_COLOR_STATES order. */
export function forkAgentColorState(input: ForkAgentStateInput): ForkAgentColorState | null {
  const dot = input.dotState
  if (dot === 'permission' || dot === 'waiting' || dot === 'blocked') {
    return 'needsYou'
  }
  if (input.stalled) {
    return 'stalled'
  }
  if (dot === 'working' || dot === 'monitoring') {
    return 'working'
  }
  if (input.queued) {
    return 'queued'
  }
  if (input.unread) {
    return 'unread'
  }
  if (dot === 'done') {
    return 'done'
  }
  return input.asleep ? 'asleep' : null
}

export type ForkAgentColorResolution =
  | { source: 'manual'; color: string }
  | { source: 'state'; state: ForkAgentColorState; color: string }
  | { source: 'none' }

/**
 * Manual tab color first, then the state's chosen color, then nothing. A state whose choice is
 * 'none' shows nothing; it does not fall through to a lower state.
 */
export function resolveForkAgentColor({
  manualColor,
  state,
  settings
}: {
  manualColor: string | null | undefined
  state: ForkAgentColorState | null
  settings: StateColorSettings | null | undefined
}): ForkAgentColorResolution {
  if (manualColor) {
    return { source: 'manual', color: manualColor }
  }
  if (!state || !forkAgentStateColorsEnabled(settings)) {
    return { source: 'none' }
  }
  const color = forkAgentColorChoiceCss(forkAgentStateColorChoice(settings, state))
  return color ? { source: 'state', state, color } : { source: 'none' }
}

/** The overlay style: a 2px edge stripe, plus a soft wash of the color when tinted. */
export function forkAgentStateColorStyle(
  color: string,
  strength: ForkAgentStateColorStrength
): { boxShadow: string; backgroundColor?: string } {
  const stripe = `inset 2px 0 0 ${color}`
  return strength === 'tint'
    ? {
        boxShadow: stripe,
        backgroundColor: `color-mix(in srgb, ${color} ${FORK_AGENT_STATE_TINT_PERCENT}%, transparent)`
      }
    : { boxShadow: stripe }
}
