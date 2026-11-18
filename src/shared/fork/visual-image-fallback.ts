// Visual fallback (FORK.md, SLRM-2349): `::orca-visual` also takes an image file from the chat's
// scratch folder and unquoted attribute values. The grammar (shared by desktop, web and mobile)
// and the host's reader call in here; each process installs a reader for the settings it can
// see, and without one the defaults hold (on, 4 MiB). The host reads the image, checks its
// first bytes, and answers with a small HTML page that inlines it, so every client shows it
// through the visual frame it already has.
// No imports: mobile bundles this file through the grammar.

export const FORK_VISUAL_IMAGE_DEFAULT_MAX_MIB = 4
export const FORK_VISUAL_IMAGE_MIN_MAX_MIB = 1
/** A 5 MiB image is about 6.7 MiB as base64, under the phone bridge's 8 MiB reply limit. */
export const FORK_VISUAL_IMAGE_MAX_MAX_MIB = 5

const MIB = 1024 * 1024

export type ForkVisualFallbackSettings = {
  enabled: boolean
  imageMaxBytes: number
}

/** The two keys in `fork-global-settings.ts`. */
type SettingKey = 'forkVisualFallback' | 'forkVisualImageMaxMiB'

/** Any settings object; values are checked here, so a hand-edited file cannot break a reader. */
export type ForkVisualFallbackSettingsSource =
  | Partial<Record<SettingKey, unknown>>
  | null
  | undefined

export function readForkVisualFallbackSettings(
  settings: ForkVisualFallbackSettingsSource
): ForkVisualFallbackSettings {
  const mib = settings?.forkVisualImageMaxMiB
  const valid =
    typeof mib === 'number' &&
    Number.isInteger(mib) &&
    mib >= FORK_VISUAL_IMAGE_MIN_MAX_MIB &&
    mib <= FORK_VISUAL_IMAGE_MAX_MAX_MIB
  return {
    enabled: settings?.forkVisualFallback !== false,
    imageMaxBytes: (valid ? mib : FORK_VISUAL_IMAGE_DEFAULT_MAX_MIB) * MIB
  }
}

let reader: () => ForkVisualFallbackSettingsSource = () => null

/** Each process points this at its own settings; the reader is called on every check. */
export function setForkVisualFallbackSettingsReader(
  next: () => ForkVisualFallbackSettingsSource
): void {
  reader = next
}

function currentSettings(): ForkVisualFallbackSettings {
  try {
    return readForkVisualFallbackSettings(reader())
  } catch {
    return readForkVisualFallbackSettings(null)
  }
}

// Same base rule as the .html names: a basename, no separators; the rest is checked by the grammar.
const IMAGE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpe?g|gif|webp)$/i

/** An image basename, whatever the setting; the host reader branches on it. */
export function isForkVisualImageName(name: string): boolean {
  return IMAGE_FILE_NAME.test(name)
}

/** The grammar's hook: an image basename counts as a visual file while the fallback is on. */
export function forkIsVisualImageFileName(name: string): boolean {
  return isForkVisualImageName(name) && currentSettings().enabled
}

// key=value with no space, quote, brace or backslash in the value; the grammar then refuses
// control characters in it as it does for quoted values.
const UNQUOTED_ATTRIBUTE = /^([a-z]+)=([^\s"'`{}\\]+)/

/** The grammar's hook for an attribute its quoted form did not match. */
export function forkUnquotedVisualAttribute(rest: string): RegExpExecArray | null {
  return currentSettings().enabled ? UNQUOTED_ATTRIBUTE.exec(rest) : null
}

/** The host's byte cap for one visual file: the image cap for images, else the stock cap. */
export function forkVisualFileMaxBytes(name: string, stockMaxBytes: number): number {
  return isForkVisualImageName(name) ? currentSettings().imageMaxBytes : stockMaxBytes
}

/** The largest document a client may receive: the stock cap or a page around the largest image. */
export function forkVisualMaxDocumentChars(stockMaxBytes: number): number {
  const base64 = Math.ceil((FORK_VISUAL_IMAGE_MAX_MAX_MIB * MIB) / 3) * 4
  return Math.max(stockMaxBytes, base64 + 2048)
}
