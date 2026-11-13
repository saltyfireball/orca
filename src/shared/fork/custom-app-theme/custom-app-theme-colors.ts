// SLRM-2097: color values a custom app theme may carry, and the hex math its importers use.

/** Longest color value accepted; real colors are far shorter. */
export const MAX_THEME_COLOR_LENGTH = 64

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/
// Why digits only inside the parentheses: no var(), url() or nested functions can ride along.
const COLOR_FUNCTION =
  /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[0-9.+-]+(?:%|deg|turn|rad|grad)?(?:\s*[,/ ]\s*[0-9.+-]+(?:%|deg|turn|rad|grad)?){2,3}\s*\)$/
const COLOR_NAME = /^[a-z]{3,20}$/
const NOT_COLORS = new Set([
  'transparent',
  'currentcolor',
  'inherit',
  'initial',
  'unset',
  'revert',
  'none',
  'auto',
  'default'
])

/** A trimmed, lower-cased color when `value` is hex, an rgb/hsl/hwb/lab/lch/oklab/oklch
 *  function of plain numbers, or a CSS color name; otherwise null. Never returns CSS text that
 *  could carry anything but a color. */
export function normalizeThemeColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const color = value.trim().toLowerCase()
  if (color.length === 0 || color.length > MAX_THEME_COLOR_LENGTH || NOT_COLORS.has(color)) {
    return null
  }
  // Why first: base16 files write hex without the '#', and `abcdef` would pass as a name.
  if (/^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(color)) {
    return `#${color}`
  }
  return HEX.test(color) || COLOR_FUNCTION.test(color) || COLOR_NAME.test(color) ? color : null
}

type Rgb = { r: number; g: number; b: number }

/** Six-digit hex for a hex color (3, 4, 6 or 8 digits, alpha dropped); null for anything else. */
export function toHex6(value: string | undefined | null): string | null {
  const color = normalizeThemeColor(value)
  if (!color || !HEX.test(color)) {
    return null
  }
  const digits = color.slice(1)
  const full =
    digits.length <= 4
      ? digits
          .slice(0, 3)
          .split('')
          .map((d) => d + d)
          .join('')
      : digits.slice(0, 6)
  return `#${full}`
}

function rgb(hex: string): Rgb {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16)
  }
}

function hex({ r, g, b }: Rgb): string {
  const part = (n: number): string =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

/** `amount` (0..1) of `top` over `bottom`, both six-digit hex. */
export function mixHex(top: string, bottom: string, amount: number): string {
  const a = rgb(top)
  const b = rgb(bottom)
  const t = Math.min(1, Math.max(0, amount))
  return hex({
    r: a.r * t + b.r * (1 - t),
    g: a.g * t + b.g * (1 - t),
    b: a.b * t + b.b * (1 - t)
  })
}

/** WCAG relative luminance of a six-digit hex color. */
export function luminance(color: string): number {
  const { r, g, b } = rgb(color)
  const channel = (n: number): number => {
    const c = n / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio of two six-digit hex colors. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
