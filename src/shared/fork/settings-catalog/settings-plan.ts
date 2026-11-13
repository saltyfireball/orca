// Settings from the CLI (FORK.md): turns a requested change (keys to set, keys to reset) into
// what would be written, or the reasons it is refused. Pure, so the host that applies it and
// the tests agree; nothing is written unless every key passes.
import { forkSettingEntry, forkSettingEntries, suggestForkSettingKey } from './settings-catalog'
import { isForkSecretValueSet } from './settings-access'
import { checkForkSettingValue, forkSettingValuesEqual } from './settings-shape'

export const FORK_SECRET_SET_TEXT = '(set, hidden)'
export const FORK_SECRET_UNSET_TEXT = '(not set)'

export type ForkSettingsChange = {
  key: string
  /** Absent when the key was not stored. A secret shows only whether it was set. */
  old?: unknown
  /** Absent when the key is cleared. */
  new?: unknown
  secret?: true
  /** Set after an apply whose stored value is not the requested one. */
  note?: string
}

export type ForkSettingsRejection = { key: string; reason: string }

export type ForkSettingsPlan = {
  /** What to hand the app; a cleared key is present with the value `undefined`. */
  update: Record<string, unknown>
  changes: ForkSettingsChange[]
  rejected: ForkSettingsRejection[]
}

export type ForkSettingsPlanInput = {
  current: Record<string, unknown>
  defaults: Record<string, unknown>
  set?: Record<string, unknown>
  reset?: readonly string[]
}

/** A value as `orca settings` may show it: a secret becomes "set" or "not set". */
export function forkSettingShown(key: string, value: unknown): unknown {
  if (!forkSettingEntry(key)?.secret) {
    return value
  }
  return isForkSecretValueSet(value) ? FORK_SECRET_SET_TEXT : FORK_SECRET_UNSET_TEXT
}

function change(key: string, before: unknown, after: unknown): ForkSettingsChange {
  const secret = forkSettingEntry(key)?.secret === true
  const shownOld = forkSettingShown(key, before)
  const shownNew = forkSettingShown(key, after)
  return {
    key,
    ...(shownOld === undefined ? {} : { old: shownOld }),
    ...(shownNew === undefined ? {} : { new: shownNew }),
    ...(secret ? { secret: true as const } : {})
  }
}

function refusal(key: string): string | null {
  const entry = forkSettingEntry(key)
  if (!entry) {
    const near = suggestForkSettingKey(key)
    return near ? `unknown setting; did you mean "${near}"?` : 'unknown setting'
  }
  return entry.readOnly ? `read-only: ${entry.readOnly}` : null
}

export function planForkSettingsUpdate(input: ForkSettingsPlanInput): ForkSettingsPlan {
  const plan: ForkSettingsPlan = { update: {}, changes: [], rejected: [] }
  const reset = new Set(input.reset ?? [])
  for (const [key, value] of Object.entries(input.set ?? {})) {
    if (reset.has(key)) {
      plan.rejected.push({ key, reason: 'named both to set and to reset' })
      continue
    }
    const entry = forkSettingEntry(key)
    // An unchanged value is never a change, whatever the key: an exported file applies clean.
    if (entry && forkSettingValuesEqual(input.current[key], value)) {
      continue
    }
    const refused = refusal(key)
    const problem = refused ?? (entry ? checkForkSettingValue(entry.shape, value) : null)
    if (problem) {
      plan.rejected.push({ key, reason: refused ?? `wrong type: ${problem} (${entry?.type})` })
      continue
    }
    plan.update[key] = value
    plan.changes.push(change(key, input.current[key], value))
  }
  for (const key of reset) {
    if (Object.hasOwn(input.set ?? {}, key)) {
      continue
    }
    const refused = refusal(key)
    if (refused) {
      plan.rejected.push({ key, reason: refused })
      continue
    }
    const value = input.defaults[key]
    if (forkSettingValuesEqual(input.current[key], value)) {
      continue
    }
    plan.update[key] = value
    plan.changes.push(change(key, input.current[key], value))
  }
  return plan
}

/**
 * The settings and defaults as they may leave the host: catalog keys only, with every secret
 * taken out and listed by name when it holds a value.
 */
export function redactForkSettings(
  settings: Record<string, unknown>,
  defaults: Record<string, unknown>
): { values: Record<string, unknown>; defaults: Record<string, unknown>; secretsSet: string[] } {
  const out = { values: {} as Record<string, unknown>, defaults: {} as Record<string, unknown> }
  const secretsSet: string[] = []
  for (const entry of forkSettingEntries()) {
    if (entry.secret) {
      if (isForkSecretValueSet(settings[entry.key])) {
        secretsSet.push(entry.key)
      }
      continue
    }
    if (settings[entry.key] !== undefined) {
      out.values[entry.key] = settings[entry.key]
    }
    if (defaults[entry.key] !== undefined) {
      out.defaults[entry.key] = defaults[entry.key]
    }
  }
  return { ...out, secretsSet }
}
