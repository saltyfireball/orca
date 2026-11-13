// SLRM-2097: the custom app theme format (docs/fork/custom-app-themes.md), its parser and the
// stored list. Values are only ever colors, a font family name or a length: no CSS text.
import { completePluginAppThemeTokens } from '../../plugins/artifacts/plugin-theme-artifact'
import type { TerminalColorOverrides } from '../../terminal-themes/terminal-color-overrides'
import {
  cleanText,
  inferBase,
  isRecord,
  normalizeThemeFont,
  normalizeThemeRadius,
  publicTokenName,
  push,
  readTerminal,
  readTokens,
  type IssueSink
} from './custom-app-theme-fields'

export {
  inferBase,
  normalizeThemeFont,
  normalizeThemeRadius,
  PUBLIC_TOKEN_SET,
  publicTokenName,
  readTerminal
} from './custom-app-theme-fields'

export type CustomAppThemeBase = 'dark' | 'light'
export type CustomAppThemeOrigin = 'orca' | 'ghostty' | 'warp' | 'base16' | 'base24'

/** A theme as the user wrote or imported it, before it is saved. */
export type CustomAppThemeDraft = {
  name: string
  base: CustomAppThemeBase
  /** Public app tokens (`--background`, ...) the theme sets; the rest fall back. */
  tokens: Record<string, string>
  terminal?: TerminalColorOverrides
  /** UI font family name. */
  font?: string
  /** Corner radius, e.g. `0.5rem` or `6px`. */
  radius?: string
  author?: string
  license?: string
  source?: string
  importedFrom: CustomAppThemeOrigin
}

/** A saved theme. */
export type CustomAppTheme = CustomAppThemeDraft & {
  id: string
  createdAt: string
}

/** What went wrong or was skipped; the settings UI words each code. */
export type CustomAppThemeIssue = {
  code:
    | 'too-large'
    | 'empty'
    | 'not-json'
    | 'not-object'
    | 'unknown-format'
    | 'bad-base'
    | 'missing-base'
    | 'bad-color'
    | 'bad-terminal-color'
    | 'bad-font'
    | 'bad-radius'
    | 'no-colors'
    | 'unknown-token'
    | 'unknown-key'
    | 'too-many-tokens'
    | 'incomplete-terminal'
  /** Where it is, like `tokens.sidebar` or `terminal.red`. */
  path?: string
}

export type CustomAppThemeParseResult =
  | { ok: true; theme: CustomAppThemeDraft; warnings: CustomAppThemeIssue[] }
  | { ok: false; errors: CustomAppThemeIssue[] }

/** Largest pasted or imported text, in characters. */
export const MAX_CUSTOM_APP_THEME_TEXT = 64 * 1024
/** Most saved custom themes. */
export const MAX_CUSTOM_APP_THEMES = 50
export const MAX_CUSTOM_APP_THEME_NAME = 80
const MAX_META = 200

const TOP_LEVEL_KEYS = new Set([
  'name',
  'base',
  'tokens',
  'terminal',
  'font',
  'radius',
  'author',
  'license',
  'source',
  '$schema',
  'schemaVersion'
])

/** Validates the Orca custom theme JSON object (already parsed). */
export function parseCustomAppThemeObject(
  value: unknown,
  importedFrom: CustomAppThemeOrigin = 'orca'
): CustomAppThemeParseResult {
  const sink: IssueSink = { errors: [], warnings: [] }
  if (!isRecord(value)) {
    return { ok: false, errors: [{ code: 'not-object' }] }
  }
  for (const key of Object.keys(value)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      push(sink.warnings, { code: 'unknown-key', path: key.slice(0, 64) })
    }
  }
  const tokens = readTokens(value.tokens, sink)
  const terminal = readTerminal(value.terminal, sink)
  let base: CustomAppThemeBase | null = null
  if (value.base === 'dark' || value.base === 'light') {
    base = value.base
  } else if (value.base !== undefined) {
    push(sink.errors, { code: 'bad-base', path: 'base' })
  } else {
    base = inferBase(tokens['--background'] ?? terminal?.background)
    if (!base) {
      push(sink.errors, { code: 'missing-base', path: 'base' })
    }
  }
  const font = value.font === undefined ? undefined : normalizeThemeFont(value.font)
  if (font === null) {
    push(sink.errors, { code: 'bad-font', path: 'font' })
  }
  const radius = value.radius === undefined ? undefined : normalizeThemeRadius(value.radius)
  if (radius === null) {
    push(sink.errors, { code: 'bad-radius', path: 'radius' })
  }
  if (
    sink.errors.length === 0 &&
    Object.keys(tokens).length === 0 &&
    !terminal &&
    !font &&
    !radius
  ) {
    push(sink.errors, { code: 'no-colors' })
  }
  if (sink.errors.length > 0 || !base) {
    return { ok: false, errors: sink.errors }
  }
  return {
    ok: true,
    warnings: sink.warnings,
    theme: {
      name: cleanText(value.name, MAX_CUSTOM_APP_THEME_NAME) ?? 'Custom theme',
      base,
      tokens,
      ...(terminal ? { terminal } : {}),
      ...(font ? { font } : {}),
      ...(radius ? { radius } : {}),
      ...optionalMeta(value),
      importedFrom
    }
  }
}

function optionalMeta(value: Record<string, unknown>): Partial<CustomAppThemeDraft> {
  const meta: Partial<CustomAppThemeDraft> = {}
  for (const key of ['author', 'license', 'source'] as const) {
    const text = cleanText(value[key], MAX_META)
    if (text) {
      meta[key] = text
    }
  }
  return meta
}

/** Rename helper: the name a saved theme gets, never empty. */
export function normalizeCustomAppThemeName(value: unknown): string | null {
  return cleanText(value, MAX_CUSTOM_APP_THEME_NAME) ?? null
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

/** A new id from the theme name, unique among `taken`. */
export function makeCustomAppThemeId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'theme'
  const start = /^[a-z0-9]/.test(slug) ? slug : `t-${slug}`
  let id = start
  for (let n = 2; used.has(id); n++) {
    id = `${start}-${n}`
  }
  return id
}

const ORIGINS = new Set<CustomAppThemeOrigin>(['orca', 'ghostty', 'warp', 'base16', 'base24'])

/** Bounds the saved list on every read: bad entries drop, bad values inside one drop. */
export function normalizeCustomAppThemes(value: unknown): CustomAppTheme[] {
  if (!Array.isArray(value)) {
    return []
  }
  const byId = new Map<string, CustomAppTheme>()
  for (const entry of value.slice(0, MAX_CUSTOM_APP_THEMES * 2)) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !ID_RE.test(entry.id)) {
      continue
    }
    // Why reparse with errors tolerated: a stored value that no longer validates must drop alone.
    const sink: IssueSink = { errors: [], warnings: [] }
    const tokens = readTokens(entry.tokens, sink)
    for (const issue of sink.errors) {
      const token = issue.path?.startsWith('tokens.') ? publicTokenName(issue.path.slice(7)) : null
      if (token) {
        delete tokens[token]
      }
    }
    const terminal = readTerminal(entry.terminal, { errors: [], warnings: [] })
    const base = entry.base === 'dark' || entry.base === 'light' ? entry.base : null
    if (!base || byId.has(entry.id)) {
      continue
    }
    const font = normalizeThemeFont(entry.font)
    const radius = normalizeThemeRadius(entry.radius)
    const origin =
      typeof entry.importedFrom === 'string' &&
      ORIGINS.has(entry.importedFrom as CustomAppThemeOrigin)
        ? (entry.importedFrom as CustomAppThemeOrigin)
        : 'orca'
    byId.set(entry.id, {
      id: entry.id,
      name: cleanText(entry.name, MAX_CUSTOM_APP_THEME_NAME) ?? 'Custom theme',
      base,
      tokens,
      ...(terminal ? { terminal } : {}),
      ...(font ? { font } : {}),
      ...(radius ? { radius } : {}),
      ...optionalMeta(entry),
      importedFrom: origin,
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt.slice(0, 40) : ''
    })
  }
  return [...byId.values()].slice(0, MAX_CUSTOM_APP_THEMES)
}

/** Every public token the theme paints: its own, plus the ones derived from its background and
 *  foreground the way plugin themes derive them. Without both, omitted tokens keep the built-in
 *  colors of the theme's base. */
export function resolveCustomAppThemeTokens(
  theme: Pick<CustomAppThemeDraft, 'tokens'>
): Record<string, string> {
  return theme.tokens['--background'] && theme.tokens['--foreground']
    ? completePluginAppThemeTokens(theme.tokens)
    : { ...theme.tokens }
}

/** Changes whenever the painted content does (FNV-1a over the tokens). */
export function customAppThemeRevision(tokens: Record<string, string>): string {
  let hash = 0x811c9dc5
  for (const ch of JSON.stringify(Object.entries(tokens).sort())) {
    hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0
  }
  return hash.toString(16)
}

/** The format JSON for a theme, as the export and copy buttons write it. */
export function exportCustomAppTheme(theme: CustomAppThemeDraft): string {
  const tokens = Object.fromEntries(
    Object.entries(theme.tokens).map(([token, value]) => [token.slice(2), value])
  )
  return `${JSON.stringify(
    {
      name: theme.name,
      base: theme.base,
      ...(theme.author ? { author: theme.author } : {}),
      ...(theme.license ? { license: theme.license } : {}),
      ...(theme.source ? { source: theme.source } : {}),
      ...(theme.font ? { font: theme.font } : {}),
      ...(theme.radius ? { radius: theme.radius } : {}),
      tokens,
      ...(theme.terminal ? { terminal: theme.terminal } : {})
    },
    null,
    2
  )}\n`
}
