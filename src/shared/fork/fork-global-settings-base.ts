// The stock settings base with the fork's own settings added. `global-settings-types.ts` imports
// this as its base, so that file carries one changed import path and no fork lines (FORK.md).
import type { GlobalSettingsBase as StockGlobalSettingsBase } from '../settings/global-settings-base'
import type { WithForkSettings } from './fork-global-settings'

export type GlobalSettingsBase = WithForkSettings<StockGlobalSettingsBase>
