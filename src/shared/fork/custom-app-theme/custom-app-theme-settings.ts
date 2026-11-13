// SLRM-2097: which custom app theme is in use, and the settings writes that save, use, rename,
// delete and reset them. The terminal half rides the stock custom terminal theme list.
import type { GlobalSettings } from '../../global-settings-types'
import {
  makeCustomTerminalThemeSelection,
  normalizeTerminalCustomThemes,
  type TerminalCustomTheme
} from '../../terminal-themes/terminal-custom-themes'
import {
  customAppThemeRevision,
  makeCustomAppThemeId,
  MAX_CUSTOM_APP_THEMES,
  normalizeCustomAppThemeName,
  normalizeCustomAppThemes,
  resolveCustomAppThemeTokens,
  type CustomAppTheme,
  type CustomAppThemeBase,
  type CustomAppThemeDraft
} from './custom-app-theme-format'

/** Terminal settings as they were before a custom theme took the terminal over. */
export type CustomAppThemeTerminalBefore = {
  terminalThemeDark?: string
  terminalThemeLight?: string
  terminalUseSeparateLightTheme?: boolean
}

export type ForkCustomAppThemeSettings = {
  /** Fork (SLRM-2097): saved custom app themes. Empty by default. */
  forkCustomAppThemes?: CustomAppTheme[]
  /** Fork (SLRM-2097): custom theme painted while Orca is dark; unset keeps the stock choice. */
  forkCustomAppThemeDark?: string | null
  /** Fork (SLRM-2097): custom theme painted while Orca is light; unset keeps the stock choice. */
  forkCustomAppThemeLight?: string | null
  /** Fork (SLRM-2097): terminal theme to restore when the custom theme is reset or deleted. */
  forkCustomAppThemeTerminalBefore?: CustomAppThemeTerminalBefore | null
}

type Settings = Partial<
  Pick<
    GlobalSettings,
    | 'forkCustomAppThemes'
    | 'forkCustomAppThemeDark'
    | 'forkCustomAppThemeLight'
    | 'forkCustomAppThemeTerminalBefore'
    | 'terminalCustomThemes'
    | 'terminalThemeDark'
    | 'terminalThemeLight'
    | 'terminalUseSeparateLightTheme'
    | 'theme'
  >
>

/** Paint ids carry this prefix, so they never collide with plugin or Match Terminal ids. */
export const CUSTOM_APP_THEME_PAINT_PREFIX = 'fork-custom:'
const TERMINAL_ENTRY_PREFIX = 'manual:app-theme-'

function slotKey(base: CustomAppThemeBase): 'forkCustomAppThemeDark' | 'forkCustomAppThemeLight' {
  return base === 'dark' ? 'forkCustomAppThemeDark' : 'forkCustomAppThemeLight'
}

/** The saved theme painted in this mode, or null. */
export function activeCustomAppTheme(
  settings: Settings | null | undefined,
  dark: boolean
): CustomAppTheme | null {
  const id = dark ? settings?.forkCustomAppThemeDark : settings?.forkCustomAppThemeLight
  if (typeof id !== 'string') {
    return null
  }
  const theme = normalizeCustomAppThemes(settings?.forkCustomAppThemes).find((t) => t.id === id)
  return theme && theme.base === (dark ? 'dark' : 'light') ? theme : null
}

/** The paint id of the theme in use for this mode, for the startup cache check. */
export function activeCustomAppThemePaintId(
  settings: Settings | null | undefined,
  dark: boolean
): string | null {
  const theme = activeCustomAppTheme(settings, dark)
  return theme ? `${CUSTOM_APP_THEME_PAINT_PREFIX}${theme.id}` : null
}

/** What `applyPluginAppTheme` paints for a saved or previewed theme. */
export function customAppThemePaint(theme: Pick<CustomAppTheme, 'id' | 'base' | 'tokens'>): {
  id: string
  revision: string
  base: CustomAppThemeBase
  tokens: Record<string, string>
} {
  const tokens = resolveCustomAppThemeTokens(theme)
  return {
    id: `${CUSTOM_APP_THEME_PAINT_PREFIX}${theme.id}`,
    revision: customAppThemeRevision(tokens),
    base: theme.base,
    tokens
  }
}

export type SaveCustomAppThemeResult =
  | { ok: true; id: string; update: Partial<GlobalSettings> }
  | { ok: false; reason: 'full' }

/** Adds a theme to the saved list. */
export function saveCustomAppThemeUpdate(
  settings: Settings,
  draft: CustomAppThemeDraft,
  now: Date = new Date()
): SaveCustomAppThemeResult {
  const themes = normalizeCustomAppThemes(settings.forkCustomAppThemes)
  if (themes.length >= MAX_CUSTOM_APP_THEMES) {
    return { ok: false, reason: 'full' }
  }
  const id = makeCustomAppThemeId(
    draft.name,
    themes.map((t) => t.id)
  )
  return {
    ok: true,
    id,
    update: {
      forkCustomAppThemes: [...themes, { ...draft, id, createdAt: now.toISOString() }]
    }
  }
}

export function renameCustomAppThemeUpdate(
  settings: Settings,
  id: string,
  name: string
): Partial<GlobalSettings> | null {
  const clean = normalizeCustomAppThemeName(name)
  const themes = normalizeCustomAppThemes(settings.forkCustomAppThemes)
  if (!clean || !themes.some((t) => t.id === id)) {
    return null
  }
  return {
    forkCustomAppThemes: themes.map((t) => (t.id === id ? { ...t, name: clean } : t))
  }
}

function terminalEntryId(themeId: string): string {
  return `${TERMINAL_ENTRY_PREFIX}${themeId}`
}

function isOurTerminalSelection(value: string | undefined): boolean {
  return (
    typeof value === 'string' &&
    value.startsWith(makeCustomTerminalThemeSelection(TERMINAL_ENTRY_PREFIX))
  )
}

/** Puts back the terminal theme from before, where a custom theme still holds the slot. */
function restoreTerminal(settings: Settings): Partial<GlobalSettings> {
  const before = settings.forkCustomAppThemeTerminalBefore ?? {}
  const update: Partial<GlobalSettings> = {
    forkCustomAppThemeTerminalBefore: null
  }
  if (isOurTerminalSelection(settings.terminalThemeDark)) {
    update.terminalThemeDark = before.terminalThemeDark ?? ''
  }
  if (isOurTerminalSelection(settings.terminalThemeLight)) {
    update.terminalThemeLight = before.terminalThemeLight ?? ''
    if (typeof before.terminalUseSeparateLightTheme === 'boolean') {
      update.terminalUseSeparateLightTheme = before.terminalUseSeparateLightTheme
    }
  }
  return update
}

/**
 * Makes a saved theme the app theme of its mode, switching Orca to that mode when `dark` (the
 * mode now showing) differs. With `withTerminal` and a terminal palette, its terminal colors
 * become a custom terminal theme selected for that mode.
 */
export function selectCustomAppThemeUpdate(
  settings: Settings,
  id: string,
  dark: boolean,
  withTerminal: boolean,
  now: Date = new Date()
): Partial<GlobalSettings> | null {
  const theme = normalizeCustomAppThemes(settings.forkCustomAppThemes).find((t) => t.id === id)
  if (!theme) {
    return null
  }
  const update: Partial<GlobalSettings> = { [slotKey(theme.base)]: theme.id }
  if ((theme.base === 'dark') !== dark) {
    update.theme = theme.base
  }
  if (!withTerminal || !theme.terminal) {
    return update
  }
  const entry: TerminalCustomTheme = {
    id: terminalEntryId(theme.id),
    name: theme.name,
    source: 'manual',
    mode: theme.base,
    terminal: theme.terminal,
    importedAt: now.toISOString(),
    sourceLabel: 'Custom app theme'
  }
  update.terminalCustomThemes = normalizeTerminalCustomThemes([
    ...normalizeTerminalCustomThemes(settings.terminalCustomThemes).filter(
      (t) => t.id !== entry.id
    ),
    entry
  ])
  if (!settings.forkCustomAppThemeTerminalBefore) {
    update.forkCustomAppThemeTerminalBefore = {
      terminalThemeDark: settings.terminalThemeDark,
      terminalThemeLight: settings.terminalThemeLight,
      terminalUseSeparateLightTheme: settings.terminalUseSeparateLightTheme
    }
  }
  const selection = makeCustomTerminalThemeSelection(entry.id)
  if (theme.base === 'dark') {
    update.terminalThemeDark = selection
  } else {
    update.terminalThemeLight = selection
    update.terminalUseSeparateLightTheme = true
  }
  return update
}

/** Back to the stock app colors in both modes, and the terminal theme from before. */
export function resetCustomAppThemeUpdate(settings: Settings): Partial<GlobalSettings> {
  return {
    forkCustomAppThemeDark: null,
    forkCustomAppThemeLight: null,
    ...restoreTerminal(settings)
  }
}

/** Removes a saved theme, its terminal entry, and any selection of it. */
export function deleteCustomAppThemeUpdate(
  settings: Settings,
  id: string
): Partial<GlobalSettings> {
  const update: Partial<GlobalSettings> = {
    forkCustomAppThemes: normalizeCustomAppThemes(settings.forkCustomAppThemes).filter(
      (t) => t.id !== id
    ),
    terminalCustomThemes: normalizeTerminalCustomThemes(settings.terminalCustomThemes).filter(
      (t) => t.id !== terminalEntryId(id)
    )
  }
  if (settings.forkCustomAppThemeDark === id) {
    update.forkCustomAppThemeDark = null
  }
  if (settings.forkCustomAppThemeLight === id) {
    update.forkCustomAppThemeLight = null
  }
  const selection = makeCustomTerminalThemeSelection(terminalEntryId(id))
  if (settings.terminalThemeDark === selection || settings.terminalThemeLight === selection) {
    Object.assign(update, restoreTerminal(settings))
  }
  return update
}
