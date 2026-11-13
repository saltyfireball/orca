// Settings from the CLI (FORK.md): applies an `orca settings` change through the handler the
// Settings screen itself uses (`settings:set`), so every guard, normalization and side effect
// of that path runs and every open window hears `settings:changed`.
import type { IpcMainInvokeEvent } from 'electron'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import {
  forkSettingShown,
  planForkSettingsUpdate,
  redactForkSettings
} from '../../../shared/fork/settings-catalog/settings-plan'
import { forkSettingValuesEqual } from '../../../shared/fork/settings-catalog/settings-shape'
import type {
  ForkSettingsGetResult,
  ForkSettingsUpdateResult
} from '../../../shared/fork/settings-wire'

type SettingsSetHandler = (
  event: IpcMainInvokeEvent,
  args: Partial<GlobalSettings>
) => Promise<GlobalSettings>

/** No window has this id, so a CLI write is broadcast to all of them. */
const CLI_ORIGIN_WEB_CONTENTS_ID = -1

let settingsSetHandler: SettingsSetHandler | undefined

/** Hook in `registerSettingsHandlers`: keeps the `settings:set` handler and returns it as is. */
export function forkCaptureSettingsSet<T extends SettingsSetHandler>(handler: T): T {
  settingsSetHandler = handler
  return handler
}

/** Hands an update to the app's own `settings:set` handler, as a writer no window owns. */
export async function forkApplyThroughSettingsSet(update: Record<string, unknown>): Promise<void> {
  if (!settingsSetHandler) {
    throw new Error(
      'This host has no settings handler to apply the change through. Run it against the desktop app.'
    )
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler reads only `sender.id` from its event.
  const event = { sender: { id: CLI_ORIGIN_WEB_CONTENTS_ID } } as unknown as IpcMainInvokeEvent
  await settingsSetHandler(event, update)
}

export type ForkSettingsCliDeps = {
  getSettings: () => Record<string, unknown>
  getDefaults: () => Record<string, unknown>
  apply: (update: Record<string, unknown>) => Promise<void>
}

export function readForkSettings(deps: ForkSettingsCliDeps): ForkSettingsGetResult {
  return redactForkSettings(deps.getSettings(), deps.getDefaults())
}

/**
 * Checks the whole request, then writes it in one update. Any refused key stops the request
 * before anything is written. The reply shows what was stored, which is not always what was
 * asked: the app normalizes values and may keep the old one.
 */
export async function updateForkSettings(
  deps: ForkSettingsCliDeps,
  params: { set?: Record<string, unknown>; reset?: readonly string[]; dryRun?: boolean }
): Promise<ForkSettingsUpdateResult> {
  const dryRun = params.dryRun === true
  const before = deps.getSettings()
  const plan = planForkSettingsUpdate({
    current: before,
    defaults: deps.getDefaults(),
    set: params.set,
    reset: params.reset
  })
  if (dryRun || plan.rejected.length > 0 || plan.changes.length === 0) {
    return { applied: false, dryRun, changes: plan.changes, rejected: plan.rejected }
  }
  await deps.apply(plan.update)
  const after = deps.getSettings()
  const changes = plan.changes.map((change) => {
    const stored = after[change.key]
    if (forkSettingValuesEqual(stored, plan.update[change.key])) {
      return change
    }
    const { new: _requested, ...rest } = change
    const shown = forkSettingShown(change.key, stored)
    return {
      ...rest,
      ...(shown === undefined ? {} : { new: shown }),
      note: forkSettingValuesEqual(stored, before[change.key])
        ? 'the app kept the old value'
        : 'the app adjusted the value'
    }
  })
  return { applied: true, dryRun, changes, rejected: [] }
}
