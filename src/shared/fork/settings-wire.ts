// Settings from the CLI (FORK.md): the fork.settings.* RPC contract between `orca settings`
// and the app that answers.
import { z } from 'zod'
import type { ForkSettingsChange, ForkSettingsRejection } from './settings-catalog/settings-plan'

/** Most keys one request may name; the settings object has a few hundred. */
const MAX_KEYS = 2000

const Key = z.string().min(1).max(200)

export const ForkSettingsGetParams = z.object({})

export const ForkSettingsUpdateParams = z.object({
  /** Keys to write, each with its new value. Keys not named are left alone. */
  set: z
    .record(Key, z.unknown())
    .refine((value) => Object.keys(value).length <= MAX_KEYS)
    .optional(),
  /** Keys to put back to their default. */
  reset: z.array(Key).max(MAX_KEYS).optional(),
  /** Report what would change and write nothing. */
  dryRun: z.boolean().optional()
})

export type ForkSettingsGetResult = {
  /** Stored values by key; a secret is never here. */
  values: Record<string, unknown>
  /** This host's defaults by key; they depend on its home folder and platform. */
  defaults: Record<string, unknown>
  /** The secret settings that hold a value. */
  secretsSet: string[]
}

export type ForkSettingsUpdateResult = {
  /** False for a dry run, for a refused request and when nothing differed. */
  applied: boolean
  dryRun: boolean
  changes: ForkSettingsChange[]
  /** Any entry here means nothing was written. */
  rejected: ForkSettingsRejection[]
}
