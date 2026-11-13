// Settings from the CLI (FORK.md): `orca settings` reads the whole global settings object and
// writes it through the app's own `settings:set` path. Reading needs no more than any other
// workspace command; writing needs the permission upstream's `settings.update` needs.
import { homedir } from 'node:os'
import { defineMethod, type RpcContext } from '../../core'
import { getDefaultSettings } from '../../../../../shared/constants'
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

function deps(ctx: RpcContext): ForkSettingsCliDeps {
  const store = ctx.runtime.requireStore()
  return {
    getSettings: () => ({ ...store.getSettings() }),
    getDefaults: () => ({ ...getDefaultSettings(homedir()) }),
    apply: forkApplyThroughSettingsSet
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
