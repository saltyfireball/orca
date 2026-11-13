// SLRM-2097: readers for the fields of a custom app theme, each value checked on its own.
import { PLUGIN_APP_THEME_TOKENS } from '../../plugins/artifacts/plugin-theme-artifact'
import type { TerminalColorOverrides } from '../../terminal-themes/terminal-color-overrides'
import {
  hasUsableTerminalThemeColors,
  TERMINAL_ANSI_COLOR_KEYS,
  TERMINAL_COLOR_KEYS
} from '../../terminal-themes/terminal-custom-themes'
import { luminance, normalizeThemeColor, toHex6 } from './custom-app-theme-colors'
import type { CustomAppThemeBase, CustomAppThemeIssue } from './custom-app-theme-format'

const MAX_TOKEN_ENTRIES = 256
const MAX_FONT = 64
const MAX_ISSUES = 20

export const PUBLIC_TOKEN_SET: ReadonlySet<string> = new Set(PLUGIN_APP_THEME_TOKENS)
const TERMINAL_KEY_SET: ReadonlySet<string> = new Set(TERMINAL_COLOR_KEYS)
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const text = [...value]
    .filter((ch) => {
      const code = ch.charCodeAt(0)
      return code >= 32 && code !== 127
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
  return text || undefined
}

/** `sidebar` and `--sidebar` both name the public token `--sidebar`. */
export function publicTokenName(key: string): string | null {
  const token = key.startsWith('--') ? key : `--${key}`
  return PUBLIC_TOKEN_SET.has(token) ? token : null
}

/** One family name of letters, digits, spaces, dots, dashes and underscores. */
export function normalizeThemeFont(value: unknown): string | null {
  const font = cleanText(value, MAX_FONT + 1)
  return font && font.length <= MAX_FONT && /^[A-Za-z0-9 ._-]+$/.test(font) ? font : null
}

/** A corner radius from 0 to 2rem (or 32px). */
export function normalizeThemeRadius(value: unknown): string | null {
  const text = typeof value === 'number' ? `${value}px` : cleanText(value, 16)
  const match = text?.toLowerCase().match(/^(\d{1,2}(?:\.\d{1,3})?)(px|rem)$/)
  if (!match) {
    return null
  }
  const amount = Number(match[1])
  return amount <= (match[2] === 'rem' ? 2 : 32) ? `${amount}${match[2]}` : null
}

export function inferBase(background: string | undefined): CustomAppThemeBase | null {
  const color = toHex6(background)
  return color ? (luminance(color) > 0.4 ? 'light' : 'dark') : null
}

export type IssueSink = {
  errors: CustomAppThemeIssue[]
  warnings: CustomAppThemeIssue[]
}

export function push(list: CustomAppThemeIssue[], issue: CustomAppThemeIssue): void {
  if (list.length < MAX_ISSUES) {
    list.push(issue)
  }
}

export function readTokens(value: unknown, sink: IssueSink): Record<string, string> {
  const tokens: Record<string, string> = {}
  if (value === undefined) {
    return tokens
  }
  if (!isRecord(value)) {
    push(sink.errors, { code: 'not-object', path: 'tokens' })
    return tokens
  }
  const entries = Object.entries(value)
  if (entries.length > MAX_TOKEN_ENTRIES) {
    push(sink.errors, { code: 'too-many-tokens', path: 'tokens' })
    return tokens
  }
  for (const [key, raw] of entries) {
    const token = publicTokenName(key)
    if (!token) {
      push(sink.warnings, {
        code: 'unknown-token',
        path: `tokens.${key.slice(0, 64)}`
      })
      continue
    }
    const color = normalizeThemeColor(raw)
    if (!color) {
      push(sink.errors, { code: 'bad-color', path: `tokens.${key}` })
      continue
    }
    tokens[token] = color
  }
  return tokens
}

const SELECTION_ALIASES: Record<string, keyof TerminalColorOverrides> = {
  selection: 'selectionBackground',
  cursorColor: 'cursor'
}

/** Terminal colors are hex only: the terminal theme path stores and compares hex. */
export function readTerminal(value: unknown, sink: IssueSink): TerminalColorOverrides | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!isRecord(value)) {
    push(sink.errors, { code: 'not-object', path: 'terminal' })
    return undefined
  }
  const terminal: TerminalColorOverrides = {}
  const set = (key: keyof TerminalColorOverrides, raw: unknown, path: string): void => {
    const color = toHex6(typeof raw === 'string' ? raw : undefined)
    if (color) {
      terminal[key] = color
    } else {
      push(sink.errors, { code: 'bad-terminal-color', path })
    }
  }
  for (const [key, raw] of Object.entries(value).slice(0, 64)) {
    if (key === 'palette' && Array.isArray(raw)) {
      raw.slice(0, 16).forEach((color, index) => {
        set(TERMINAL_ANSI_COLOR_KEYS[index], color, `terminal.palette.${index}`)
      })
      continue
    }
    const target = TERMINAL_KEY_SET.has(key)
      ? (key as keyof TerminalColorOverrides)
      : SELECTION_ALIASES[key]
    if (target) {
      set(target, raw, `terminal.${key}`)
    } else {
      push(sink.warnings, {
        code: 'unknown-key',
        path: `terminal.${key.slice(0, 64)}`
      })
    }
  }
  if (!hasUsableTerminalThemeColors(terminal)) {
    push(sink.warnings, { code: 'incomplete-terminal', path: 'terminal' })
    return undefined
  }
  return terminal
}
