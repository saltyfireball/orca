// SLRM-2097: app colors and terminal colors derived from a terminal-style palette.
import type { TerminalColorOverrides } from '../../terminal-themes/terminal-color-overrides'
import { TERMINAL_ANSI_COLOR_KEYS } from '../../terminal-themes/terminal-custom-themes'
import { contrastRatio, mixHex, toHex6 } from './custom-app-theme-colors'

/** A terminal-style palette, the common ground of every importer. */
export type SourcePalette = {
  name?: string
  author?: string
  background: string
  foreground: string
  /** Sixteen ANSI colors by index; holes are allowed. */
  ansi: (string | undefined)[]
  cursor?: string
  selectionBackground?: string
  selectionForeground?: string
  /** Highlight color for buttons, links and the active tab. Defaults to blue. */
  accent?: string
  /** A raised surface (base16 base01). */
  surface?: string
  /** Dim text (base16 base04). */
  dimText?: string
}

/** App tokens derived from a palette. Every value is six-digit hex. */
export function deriveAppTokens(palette: SourcePalette): Record<string, string> {
  const bg = toHex6(palette.background)
  const fg = toHex6(palette.foreground)
  if (!bg || !fg) {
    return {}
  }
  const ansi = (index: number): string | undefined => toHex6(palette.ansi[index]) ?? undefined
  const mix = (amount: number): string => mixHex(fg, bg, amount)
  const tint = (color: string | undefined, amount: number): string | undefined =>
    color ? mixHex(color, bg, amount) : undefined
  const blue = ansi(4) ?? ansi(12)
  const accent = toHex6(palette.accent) ?? blue ?? fg
  const red = ansi(1)
  const green = ansi(2)
  const yellow = ansi(3)
  const magenta = ansi(5)
  const cyan = ansi(6)
  const surface = toHex6(palette.surface) ?? mix(0.06)
  const selection = toHex6(palette.selectionBackground) ?? mix(0.2)
  // Why the contrast floor: many palettes' bright black is too dim to read as secondary text.
  const dimCandidate = toHex6(palette.dimText) ?? ansi(8)
  const dim = dimCandidate && contrastRatio(dimCandidate, bg) >= 3.5 ? dimCandidate : mix(0.62)
  const onAccent = contrastRatio(accent, bg) >= contrastRatio(accent, fg) ? bg : fg
  const border = mix(0.14)
  const hover = mix(0.1)
  const tokens: Record<string, string | undefined> = {
    '--background': bg,
    '--foreground': fg,
    '--editor-surface': bg,
    '--card': bg,
    '--card-foreground': fg,
    '--popover': surface,
    '--popover-foreground': fg,
    '--primary': accent,
    '--primary-foreground': onAccent,
    '--secondary': surface,
    '--secondary-foreground': fg,
    '--muted': surface,
    '--muted-foreground': dim,
    '--accent': hover,
    '--accent-foreground': fg,
    '--border': border,
    '--input': border,
    '--ring': accent,
    '--sidebar': surface,
    '--sidebar-foreground': fg,
    '--sidebar-accent': hover,
    '--sidebar-accent-foreground': fg,
    '--sidebar-border': border,
    '--tab-bar': surface,
    '--tab-active': bg,
    '--tab-active-foreground': fg,
    '--tab-active-indicator': accent,
    '--tab-inactive': surface,
    '--tab-inactive-foreground': dim,
    '--split-divider': border,
    '--split-divider-hover': accent,
    '--host-badge': hover,
    '--host-badge-foreground': fg,
    '--chat-user-message': mix(0.08),
    '--chat-bold-foreground': fg,
    '--chat-muted-foreground': dim,
    '--chat-inline-code': hover,
    '--chat-inline-code-foreground': cyan ?? fg,
    '--chat-code-block': surface,
    '--chat-selection': selection,
    '--chat-selection-foreground': toHex6(palette.selectionForeground) ?? fg,
    '--text-link': blue ?? accent,
    '--diff-added': green,
    '--diff-added-background': tint(green, 0.14),
    '--diff-added-emphasis': tint(green, 0.3),
    '--diff-added-gutter': tint(green, 0.22),
    '--diff-removed': red,
    '--diff-removed-background': tint(red, 0.14),
    '--diff-removed-emphasis': tint(red, 0.3),
    '--diff-removed-gutter': tint(red, 0.22),
    '--git-decoration-added': green,
    '--git-decoration-modified': yellow,
    '--git-decoration-deleted': red,
    '--git-decoration-renamed': cyan,
    '--git-decoration-untracked': green,
    '--git-decoration-copied': cyan,
    '--git-decoration-ignored': dim,
    '--chart-1': accent,
    '--chart-2': green,
    '--chart-3': yellow,
    '--chart-4': magenta,
    '--chart-5': cyan
  }
  return Object.fromEntries(
    Object.entries(tokens).filter((entry): entry is [string, string] => Boolean(entry[1]))
  )
}

/** The terminal half of a theme, from the same palette. */
export function paletteTerminal(palette: SourcePalette): TerminalColorOverrides {
  const terminal: TerminalColorOverrides = {}
  const set = (key: keyof TerminalColorOverrides, value: string | undefined): void => {
    const color = toHex6(value)
    if (color) {
      terminal[key] = color
    }
  }
  set('background', palette.background)
  set('foreground', palette.foreground)
  set('cursor', palette.cursor)
  set('selectionBackground', palette.selectionBackground)
  set('selectionForeground', palette.selectionForeground)
  TERMINAL_ANSI_COLOR_KEYS.forEach((key, index) => set(key, palette.ansi[index]))
  return terminal
}
