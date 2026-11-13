// Settings from the CLI (FORK.md): one entry for every key of the app's global settings
// object. The rows are generated from the `GlobalSettings` type; this file reads them and
// proves, in the type check, that they name exactly the keys of that type.
import type { GlobalSettings } from '../../global-settings-types'
import { FORK_SETTINGS_AREA_ROWS } from './settings-catalog-rows.generated'
import { forkSettingReadOnlyReason, isForkSettingSecret } from './settings-access'
import { describeForkSettingShape, type ForkSettingShape } from './settings-shape'

type CatalogKey = keyof (typeof FORK_SETTINGS_AREA_ROWS)[number]['rows']
type AllKeys<T> = T extends unknown ? keyof T : never
type NamedKey = AllKeys<(typeof FORK_SETTINGS_AREA_ROWS)[number]['rows']>

/**
 * Fails the type check when a settings key has no catalog row, or a row names a key that is
 * gone. The fix is `pnpm run generate:fork-settings-catalog`.
 */
type Missing = Exclude<keyof GlobalSettings, NamedKey>
type Stale = Exclude<NamedKey, keyof GlobalSettings>
const CATALOG_MATCHES_SETTINGS_TYPE: [Missing, Stale] extends [never, never] ? true : never = true
void CATALOG_MATCHES_SETTINGS_TYPE

export type ForkSettingsArea = { id: string; title: string }

export type ForkSettingEntry = {
  key: string
  area: string
  description: string
  shape: ForkSettingShape
  /** The type as one readable line. */
  type: string
  /** The key may be absent from the stored settings. */
  optional: boolean
  /** Why `orca settings` will not write this key; null when it will. */
  readOnly: string | null
  /** The value is never shown. */
  secret: boolean
}

type Row = { t: ForkSettingShape; d: string; o?: boolean }

export const FORK_SETTINGS_AREAS: readonly ForkSettingsArea[] = FORK_SETTINGS_AREA_ROWS.map(
  ({ id, title }) => ({ id, title })
)

function readEntries(): ForkSettingEntry[] {
  return FORK_SETTINGS_AREA_ROWS.flatMap((area) =>
    Object.entries(area.rows as Record<CatalogKey | string, string>).map(([key, json]) => {
      const row = JSON.parse(json) as Row
      return {
        key,
        area: area.id,
        description: row.d,
        shape: row.t,
        type: describeForkSettingShape(row.t),
        optional: row.o === true,
        readOnly: forkSettingReadOnlyReason(key),
        secret: isForkSettingSecret(key)
      }
    })
  )
}

let entries: ForkSettingEntry[] | undefined
let byKey: Map<string, ForkSettingEntry> | undefined

/** Every setting, grouped by area in the catalog's order and by name inside an area. */
export function forkSettingEntries(): readonly ForkSettingEntry[] {
  entries ??= readEntries()
  return entries
}

export function forkSettingEntry(key: string): ForkSettingEntry | undefined {
  byKey ??= new Map(forkSettingEntries().map((entry) => [entry.key, entry]))
  return byKey.get(key)
}

/** "Did you mean" for a key that is not a setting: the same name in another letter case. */
export function suggestForkSettingKey(key: string): string | undefined {
  const lower = key.toLowerCase()
  return forkSettingEntries().find((entry) => entry.key.toLowerCase() === lower)?.key
}
