// Settings from the CLI (FORK.md): `orca settings` reads the whole global settings object and
// writes it through the app's own `settings:set` path. Reading needs no more than any other
// workspace command; writing needs the permission upstream's `settings.update` needs. A host
// with no desktop app (`orca serve`) writes its own settings store instead.
import { homedir } from 'node:os'
import { defineMethod, type RpcContext } from '../../core'
import { getDefaultSettings } from '../../../../../shared/orca-profiles/constants'
import {
  ForkSettingsGetParams,
  ForkSettingsUpdateParams
} from '../../../../../shared/fork/settings-wire'
import {
  forkApplyThroughSettingsSet,
  readForkSettings,
  updateForkSettings,
  type ForkSettingsCliDeps
} from '../../../../fork/settings-cli/settings-cli-apply'
import {
  forkApplyHeadlessSettings,
  forkHeadlessSettingRefusal,
  forkIsHeadlessSettingsHost
} from '../../../../fork/settings-cli/settings-cli-headless'

function deps(ctx: RpcContext): ForkSettingsCliDeps {
  const store = ctx.runtime.requireStore()
  const read = {
    getSettings: () => ({ ...store.getSettings() }),
    getDefaults: () => ({ ...getDefaultSettings(homedir()) })
  }
  if (!forkIsHeadlessSettingsHost()) {
    return { ...read, apply: forkApplyThroughSettingsSet }
  }
  return {
    ...read,
    apply: (update) => forkApplyHeadlessSettings(store, update),
    refuse: forkHeadlessSettingRefusal
  }
}

export const FORK_SETTINGS_METHODS = [
  defineMethod({
    name: 'fork.settings.get',
    permission: 'workspace',
    params: ForkSettingsGetParams,
    handler: async (_params, ctx) => readForkSettings(deps(ctx))
  }),
  defineMethod({
    name: 'fork.settings.update',
    permission: 'settings-write',
    params: ForkSettingsUpdateParams,
    handler: async (params, ctx) => updateForkSettings(deps(ctx), params)
  })
]
