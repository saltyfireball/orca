// SLRM-2097: turns what a user already has (an Orca theme JSON, a Ghostty or Warp terminal theme,
// a base16/base24 scheme) into a custom app theme, deriving the app colors from the palette.
import { parseDocument } from 'yaml'
import { toHex6 } from './custom-app-theme-colors'
import { deriveAppTokens, paletteTerminal, type SourcePalette } from './custom-app-theme-derive'
import { isRecord } from './custom-app-theme-fields'
import {
  inferBase,
  MAX_CUSTOM_APP_THEME_TEXT,
  parseCustomAppThemeObject,
  type CustomAppThemeOrigin,
  type CustomAppThemeParseResult
} from './custom-app-theme-format'

export { deriveAppTokens, paletteTerminal, type SourcePalette } from './custom-app-theme-derive'

function fromPalette(
  palette: SourcePalette,
  origin: CustomAppThemeOrigin,
  fallbackName: string
): CustomAppThemeParseResult {
  if (!toHex6(palette.background) || !toHex6(palette.foreground)) {
    return { ok: false, errors: [{ code: 'no-colors' }] }
  }
  return parseCustomAppThemeObject(
    {
      name: palette.name ?? fallbackName,
      base: inferBase(palette.background) ?? 'dark',
      ...(palette.author ? { author: palette.author } : {}),
      tokens: deriveAppTokens(palette),
      terminal: paletteTerminal(palette)
    },
    origin
  )
}

/** Ghostty theme or config text: `palette = N=#hex`, `background = ...` and friends. */
export function parseGhosttyPalette(text: string): SourcePalette | null {
  const values: Record<string, string> = {}
  const ansi: (string | undefined)[] = []
  for (const rawLine of text.split(/\r?\n/).slice(0, 2000)) {
    const line = rawLine.trim()
    const match = line.match(/^([a-z0-9-]+)\s*=\s*(.*?)\s*$/i)
    if (!match || line.startsWith('#')) {
      continue
    }
    const [, key, value] = match
    const entry = key.toLowerCase() === 'palette' ? value.match(/^(\d{1,2})\s*=\s*(\S+)$/) : null
    if (entry && Number(entry[1]) < 16) {
      ansi[Number(entry[1])] = entry[2]
    } else {
      values[key.toLowerCase()] = value.replace(/^"(.*)"$/, '$1')
    }
  }
  if (!values.background || !values.foreground) {
    return null
  }
  return {
    background: values.background,
    foreground: values.foreground,
    ansi,
    cursor: values['cursor-color'],
    selectionBackground: values['selection-background'],
    selectionForeground: values['selection-foreground']
  }
}

const WARP_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const

function warpColor(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  // Why: a Warp gradient is {top, bottom}; its first stop stands in for the solid color.
  return isRecord(value) && typeof value.top === 'string' ? value.top : undefined
}

/** A Warp theme object (from its YAML). */
export function warpPalette(value: Record<string, unknown>): SourcePalette | null {
  const background = warpColor(value.background)
  const foreground = warpColor(value.foreground)
  if (!background || !foreground) {
    return null
  }
  const colors = isRecord(value.terminal_colors) ? value.terminal_colors : {}
  const normal = isRecord(colors.normal) ? colors.normal : {}
  const bright = isRecord(colors.bright) ? colors.bright : {}
  return {
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    background,
    foreground,
    accent: warpColor(value.accent),
    cursor: warpColor(value.cursor) ?? warpColor(value.accent),
    ansi: [
      ...WARP_NAMES.map((n) => warpColor(normal[n])),
      ...WARP_NAMES.map((n) => warpColor(bright[n]))
    ]
  }
}

/** A base16 or base24 scheme object, in the classic flat shape or the tinted-theming `palette`. */
export function base16Palette(
  value: Record<string, unknown>
): { palette: SourcePalette; system: 'base16' | 'base24' } | null {
  const source = isRecord(value.palette) ? value.palette : value
  const c = (n: string): string | undefined => {
    const raw = source[`base${n}`] ?? source[`base${n.toLowerCase()}`]
    return typeof raw === 'string' ? raw : undefined
  }
  if (!c('00') || !c('05')) {
    return null
  }
  const base24 = Boolean(c('12') && c('16'))
  const name = value.name ?? value.scheme
  const normal = [c('00'), c('08'), c('0B'), c('0A'), c('0D'), c('0E'), c('0C'), c('05')]
  const bright = base24
    ? [c('03'), c('12'), c('14'), c('13'), c('16'), c('17'), c('15'), c('07')]
    : [c('03'), c('08'), c('0B'), c('0A'), c('0D'), c('0E'), c('0C'), c('07')]
  return {
    system: base24 ? 'base24' : 'base16',
    palette: {
      ...(typeof name === 'string' ? { name } : {}),
      ...(typeof value.author === 'string' ? { author: value.author } : {}),
      background: c('00') as string,
      foreground: c('05') as string,
      ansi: [...normal, ...bright],
      cursor: c('05'),
      selectionBackground: c('02'),
      selectionForeground: c('05'),
      accent: c('0D'),
      surface: c('01'),
      dimText: c('04')
    }
  }
}

function parseYaml(text: string): unknown {
  try {
    const document = parseDocument(text, {
      logLevel: 'silent',
      prettyErrors: false
    })
    return document.errors.length > 0 ? undefined : document.toJS({ maxAliasCount: 20 })
  } catch {
    return undefined
  }
}

function fromObject(
  value: Record<string, unknown>,
  fallbackName: string
): CustomAppThemeParseResult {
  const scheme = base16Palette(value)
  if (scheme && !('tokens' in value)) {
    return fromPalette(scheme.palette, scheme.system, fallbackName)
  }
  if (isRecord(value.terminal_colors)) {
    const warp = warpPalette(value)
    return warp
      ? fromPalette(warp, 'warp', fallbackName)
      : { ok: false, errors: [{ code: 'no-colors' }] }
  }
  return parseCustomAppThemeObject(value, 'orca')
}

/** Reads pasted or imported text in any supported format. `fallbackName` names a theme whose
 *  source has no name, such as a Ghostty file named after the theme. */
export function importCustomAppTheme(
  text: string,
  fallbackName = 'Imported theme'
): CustomAppThemeParseResult {
  if (text.length > MAX_CUSTOM_APP_THEME_TEXT) {
    return { ok: false, errors: [{ code: 'too-large' }] }
  }
  const trimmed = text.trim()
  if (!trimmed) {
    return { ok: false, errors: [{ code: 'empty' }] }
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let value: unknown
    try {
      value = JSON.parse(trimmed)
    } catch {
      return { ok: false, errors: [{ code: 'not-json' }] }
    }
    return isRecord(value)
      ? fromObject(value, fallbackName)
      : { ok: false, errors: [{ code: 'not-object' }] }
  }
  if (/^\s*(?:palette|background|foreground)\s*=/m.test(trimmed)) {
    const palette = parseGhosttyPalette(trimmed)
    return palette
      ? fromPalette(palette, 'ghostty', fallbackName)
      : { ok: false, errors: [{ code: 'no-colors' }] }
  }
  const yaml = parseYaml(trimmed)
  if (isRecord(yaml) && (base16Palette(yaml) || isRecord(yaml.terminal_colors))) {
    return fromObject(yaml, fallbackName)
  }
  return { ok: false, errors: [{ code: 'unknown-format' }] }
}
