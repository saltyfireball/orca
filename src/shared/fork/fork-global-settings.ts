import type { ForkCustomAppThemeSettings } from './custom-app-theme/custom-app-theme-settings'

/** Fork-only settings, kept out of the upstream settings type so it stays under its line budget. */
export type ForkGlobalSettings = ForkCustomAppThemeSettings & {
  /** Fork (SLRM-1394): Claude chats keep running through an app restart. Off unless true. */
  forkChatSurvive?: boolean
  /** Fork (SLRM-1503): show which Claude account each session runs on; unset is on. */
  forkShowAccountChip?: boolean
  /** Fork (SLRM-2095): the running/total child count on sidebar agent rows; unset is on. */
  forkShowChildTally?: boolean
  /** Fork (SLRM-2095): finished children count toward that total; unset is on. */
  forkChildTallyCountFinished?: boolean
  /** Fork (SLRM-2095): background shell tasks and monitors count as children; unset is on. */
  forkChildTallyCountTasks?: boolean
}

/** Upstream's settings base plus the fork's settings; one hook in `global-settings-types.ts`. */
export type WithForkSettings<Base> = Base & ForkGlobalSettings
