// Settings from the CLI (FORK.md): the rows and text `orca settings` prints.
import {
  FORK_SETTINGS_AREAS,
  forkSettingEntries,
  type ForkSettingEntry
} from '../../shared/fork/settings-catalog/settings-catalog'
import {
  isForkSettingChanged,
  type ForkSettingsSnapshot
} from '../../shared/fork/settings-catalog/settings-jsonc'
import {
  FORK_SECRET_SET_TEXT,
  FORK_SECRET_UNSET_TEXT,
  type ForkSettingsChange
} from '../../shared/fork/settings-catalog/settings-plan'
import type { ForkSettingsUpdateResult } from '../../shared/fork/settings-wire'

export type ForkSettingRow = {
  key: string
  area: string
  type: string
  description: string
  /** Absent when nothing is stored, and always for a secret. */
  value?: unknown
  default?: unknown
  /** The value differs from the default; for a secret, it is set. */
  changed: boolean
  /** Why the CLI will not write it. */
  readOnly?: string
  secret?: true
  /** Secrets only: whether a value is stored. */
  set?: boolean
}

const LIST_VALUE_MAX = 60

export function buildSettingRow(
  entry: ForkSettingEntry,
  snapshot: ForkSettingsSnapshot
): ForkSettingRow {
  const base = {
    key: entry.key,
    area: entry.area,
    type: entry.type,
    description: entry.description,
    ...(entry.readOnly ? { readOnly: entry.readOnly } : {})
  }
  if (entry.secret) {
    const set = snapshot.secretsSet.includes(entry.key)
    return { ...base, changed: set, secret: true, set }
  }
  const value = snapshot.values[entry.key]
  const fallback = snapshot.defaults[entry.key]
  return {
    ...base,
    ...(value === undefined ? {} : { value }),
    ...(fallback === undefined ? {} : { default: fallback }),
    changed: isForkSettingChanged(entry.key, snapshot)
  }
}

export function buildSettingRows(
  snapshot: ForkSettingsSnapshot,
  options: { changed?: boolean; filter?: string } = {}
): ForkSettingRow[] {
  const needle = options.filter?.toLowerCase()
  return forkSettingEntries()
    .map((entry) => buildSettingRow(entry, snapshot))
    .filter((row) => !options.changed || row.changed)
    .filter(
      (row) =>
        !needle ||
        [row.key, row.area, row.description].some((text) => text.toLowerCase().includes(needle))
    )
}

function text(value: unknown): string {
  return value === undefined ? '(not set)' : JSON.stringify(value)
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value
}

function shownValue(row: ForkSettingRow): string {
  if (row.secret) {
    return row.set ? FORK_SECRET_SET_TEXT : FORK_SECRET_UNSET_TEXT
  }
  return text(row.value)
}

function listLine(row: ForkSettingRow): string {
  const fallback = row.secret ? '' : `  [default ${clip(text(row.default), LIST_VALUE_MAX)}]`
  const marks = `${row.readOnly ? '  [read-only]' : ''}${row.secret ? '  [secret]' : ''}`
  return `${row.changed ? '*' : ' '} ${row.key} = ${clip(shownValue(row), LIST_VALUE_MAX)}${fallback}  <${row.type}>${marks}  ${row.description}`
}

export function formatSettingsList(rows: readonly ForkSettingRow[]): string {
  if (rows.length === 0) {
    return 'No settings match.'
  }
  const lines: string[] = []
  for (const area of FORK_SETTINGS_AREAS) {
    const inArea = rows.filter((row) => row.area === area.id)
    if (inArea.length > 0) {
      lines.push(`${area.title}`, ...inArea.map(listLine), '')
    }
  }
  const changed = rows.filter((row) => row.changed).length
  lines.push(
    `${rows.length} settings, ${changed} changed from their default (marked *).`,
    'One setting in full: orca settings get <key>. All of them as a file: orca settings export.'
  )
  return lines.join('\n')
}

export function formatSetting(row: ForkSettingRow): string {
  const title = FORK_SETTINGS_AREAS.find((area) => area.id === row.area)?.title ?? row.area
  const lines = [`${row.key}  (${title})`, `  ${row.description}`, `  type:    ${row.type}`]
  const value = row.secret ? shownValue(row) : (JSON.stringify(row.value, null, 2) ?? '(not set)')
  lines.push(
    `  value:   ${value.split('\n').join('\n  ')}${row.changed && !row.secret ? '  (changed)' : ''}`
  )
  if (!row.secret) {
    lines.push(
      `  default: ${(JSON.stringify(row.default, null, 2) ?? '(not set)').split('\n').join('\n  ')}`
    )
  }
  if (row.secret) {
    lines.push('  secret:  the value is never shown')
  }
  if (row.readOnly) {
    lines.push(`  read-only: ${row.readOnly}`)
  }
  return lines.join('\n')
}

function changeLine(change: ForkSettingsChange): string {
  const note = change.note ? `  (${change.note})` : ''
  return `  ${change.key}: ${text(change.old)} -> ${text(change.new)}${note}`
}

export function formatSettingsUpdate(result: ForkSettingsUpdateResult): string {
  if (result.changes.length === 0) {
    return 'Nothing to change: every value is already as asked.'
  }
  const count = `${result.changes.length} setting${result.changes.length === 1 ? '' : 's'}`
  const head = result.dryRun
    ? `Would change ${count} (dry run, nothing written):`
    : `Changed ${count}:`
  return [head, ...result.changes.map(changeLine)].join('\n')
}

/** The message of a refused change: every refused key with its reason. */
export function formatSettingsRejection(result: ForkSettingsUpdateResult): string {
  return [
    'Nothing was written. Refused:',
    ...result.rejected.map((entry) => `  ${entry.key}: ${entry.reason}`)
  ].join('\n')
}
