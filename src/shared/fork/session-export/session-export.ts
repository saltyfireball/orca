// Session export (FORK.md, BAD-688): a chat or terminal agent's conversation as one document that
// `orca agent export` and the chat tab menu render to Markdown, HTML or JSON. Pure.
import { z } from 'zod'

export const SESSION_EXPORT_FORMATS = ['md', 'html', 'json'] as const
export type SessionExportFormat = (typeof SESSION_EXPORT_FORMATS)[number]

export const SESSION_EXPORT_DEFAULT_MAX_ENTRIES = 500
export const SESSION_EXPORT_MIN_MAX_ENTRIES = 10
export const SESSION_EXPORT_MAX_MAX_ENTRIES = 5000

/** activity: a tool call or file edit, one collapsed line. system: Orca's own notes (a handoff). */
export type SessionExportRole = 'user' | 'assistant' | 'system' | 'activity'

export type SessionExportEntry = { role: SessionExportRole; text: string }

export type SessionExportDocument = {
  /** The Orca session id the export was asked for. */
  id: string
  kind: 'chat' | 'terminal'
  agent: string | null
  title: string
  entries: SessionExportEntry[]
  /** Older entries, or text inside entries, were left out (the host's limits or the setting). */
  truncated: boolean
  /** Home folders of the host that holds the conversation, so redaction can name them. */
  homeDirs: string[]
}

export type SessionExportSettings = {
  /** Strip secrets and home paths from a file export unless the command says otherwise. */
  redact: boolean
  maxEntries: number
  includeActivity: boolean
}

export type SessionExportSettingsSource = {
  forkSessionExportRedact?: unknown
  forkSessionExportMaxEntries?: unknown
  forkSessionExportIncludeActivity?: unknown
} | null

export type ForkSessionExportSettings = {
  /** Fork (BAD-688): redact secrets and home paths in `orca agent export` files; unset is on. A share always redacts. */
  forkSessionExportRedact?: boolean
  /** Fork (BAD-688): newest entries one export holds; unset is 500. */
  forkSessionExportMaxEntries?: number
  /** Fork (BAD-688): keep tool calls and file edits as collapsed lines in an export; unset is on. */
  forkSessionExportIncludeActivity?: boolean
}

export function readSessionExportSettings(
  settings: SessionExportSettingsSource | undefined
): SessionExportSettings {
  const max = settings?.forkSessionExportMaxEntries
  return {
    redact: settings?.forkSessionExportRedact !== false,
    maxEntries:
      typeof max === 'number' && Number.isInteger(max)
        ? Math.min(SESSION_EXPORT_MAX_MAX_ENTRIES, Math.max(SESSION_EXPORT_MIN_MAX_ENTRIES, max))
        : SESSION_EXPORT_DEFAULT_MAX_ENTRIES,
    includeActivity: settings?.forkSessionExportIncludeActivity !== false
  }
}

export function isSessionExportFormat(value: unknown): value is SessionExportFormat {
  return SESSION_EXPORT_FORMATS.some((format) => format === value)
}

// Plain object with no transforms: the mobile RPC fence refuses a wider parsed shape.
export const ForkSessionExportReadParams = z.object({ id: z.string().min(1).max(200) }).strict()

/** Keeps the newest `maxEntries`, and drops activity lines when the setting says so. */
export function limitSessionExportEntries(
  entries: readonly SessionExportEntry[],
  settings: Pick<SessionExportSettings, 'maxEntries' | 'includeActivity'>
): { entries: SessionExportEntry[]; cut: boolean } {
  const kept = settings.includeActivity
    ? [...entries]
    : entries.filter((entry) => entry.role !== 'activity')
  const cut = kept.length > settings.maxEntries
  return { entries: cut ? kept.slice(kept.length - settings.maxEntries) : kept, cut }
}
