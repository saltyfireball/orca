// Settings from the CLI (FORK.md): the settings file `orca settings export` writes and
// `orca settings apply` reads. It is JSON with comments (JSONC): `//` and `/* */` comments
// and a comma after the last entry are allowed.
import { FORK_SETTINGS_AREAS, forkSettingEntries, type ForkSettingEntry } from './settings-catalog'
import { forkSettingValuesEqual } from './settings-shape'

export type ForkSettingsSnapshot = {
  values: Record<string, unknown>
  defaults: Record<string, unknown>
  secretsSet: readonly string[]
}

/** Blanks out comments, keeping every line break and column so error positions hold. */
function stripComments(text: string): string {
  let out = ''
  let index = 0
  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]
    if (char === '"') {
      const start = index
      index += 1
      while (index < text.length && text[index] !== '"') {
        index += text[index] === '\\' ? 2 : 1
      }
      index += 1
      out += text.slice(start, index)
    } else if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') {
        out += ' '
        index += 1
      }
    } else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', index + 2)
      const stop = end === -1 ? text.length : end + 2
      out += text.slice(index, stop).replace(/[^\n]/g, ' ')
      index = stop
    } else {
      out += char
      index += 1
    }
  }
  return out
}

/** Blanks out a comma that is followed only by white space and a closing bracket. */
function stripTrailingCommas(text: string): string {
  let out = ''
  let inString = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      out += char
      if (char === '\\') {
        index += 1
        out += text[index] ?? ''
      } else if (char === '"') {
        inString = false
      }
    } else if (char === '"') {
      inString = true
      out += char
    } else if (char === ',' && /^\s*[}\]]/.test(text.slice(index + 1))) {
      out += ' '
    } else {
      out += char
    }
  }
  return out
}

function lineOf(text: string, position: number): number {
  return text.slice(0, position).split('\n').length
}

/** Parses a settings file into its top-level keys. Throws an Error that names the line. */
export function parseForkSettingsFile(text: string): Record<string, unknown> {
  const json = stripTrailingCommas(stripComments(text))
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const position = /position (\d+)/.exec(message)
    const where = position ? ` (line ${lineOf(json, Number(position[1]))})` : ''
    throw new Error(`The settings file is not valid JSON${where}: ${message}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('The settings file must hold one object: { "key": value, ... }')
  }
  return parsed as Record<string, unknown>
}

function commented(text: string): string[] {
  return text.split('\n').map((line) => `  // ${line}`)
}

function entryLines(entry: ForkSettingEntry, snapshot: ForkSettingsSnapshot): string[] {
  const { key } = entry
  const fallback = snapshot.defaults[key]
  const defaultText = fallback === undefined ? 'not set' : JSON.stringify(fallback)
  const lines = [`  // ${entry.description}`]
  if (entry.secret) {
    const state = snapshot.secretsSet.includes(key) ? 'set' : 'not set'
    return [
      ...lines,
      `  // type: ${entry.type}`,
      `  // secret: ${state}. The value is never written to this file. To change it:`,
      `  //   orca settings set ${key} VALUE`
    ]
  }
  lines.push(`  // type: ${entry.type}   default: ${defaultText}`)
  const value = snapshot.values[key]
  const body = `${JSON.stringify(key)}: ${JSON.stringify(value ?? null, null, 2)},`
  if (entry.readOnly) {
    return [...lines, `  // read-only: ${entry.readOnly}`, ...commented(body)]
  }
  if (value === undefined) {
    // Nothing stored and no value to show: left as a comment so apply does not write null.
    return [
      ...lines,
      '  // not set. Remove the "//" below and give it a value to set it.',
      `  // ${JSON.stringify(key)}: ,`
    ]
  }
  return [...lines, ...body.split('\n').map((line) => `  ${line}`)]
}

export function isForkSettingChanged(key: string, snapshot: ForkSettingsSnapshot): boolean {
  return !forkSettingValuesEqual(snapshot.values[key], snapshot.defaults[key])
}

/**
 * The whole settings object as one JSONC file: grouped by area, each key under its
 * description, type and default. Read-only keys and unset keys are comments; a secret shows
 * only whether it is set.
 */
export function renderForkSettingsFile(
  snapshot: ForkSettingsSnapshot,
  options: { changedOnly?: boolean } = {}
): string {
  const lines = [
    '// Settings of this app, written by `orca settings export`.',
    '// Edit the values, then run: orca settings apply --file THIS_FILE --dry-run',
    '// and again without --dry-run to write them. A key you delete or comment out is left',
    '// as it is. Lines that are comments here (read-only keys, secrets, keys with no value)',
    '// are not applied.',
    '{'
  ]
  for (const area of FORK_SETTINGS_AREAS) {
    const entries = forkSettingEntries().filter(
      (entry) =>
        entry.area === area.id &&
        (!options.changedOnly ||
          (entry.secret
            ? snapshot.secretsSet.includes(entry.key)
            : isForkSettingChanged(entry.key, snapshot)))
    )
    if (entries.length === 0) {
      continue
    }
    lines.push('', `  // ==== ${area.title} ====`)
    for (const entry of entries) {
      lines.push('', ...entryLines(entry, snapshot))
    }
  }
  lines.push('}', '')
  return lines.join('\n')
}
