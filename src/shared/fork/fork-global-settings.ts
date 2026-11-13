import type { LostWorkSettings } from './lost-work'

/** Fork-only settings, kept out of the upstream settings type so it stays under its line budget. */
export type ForkGlobalSettings = {
  /** Fork (SLRM-2096): the lost work scan's checks, base branches and archive folder. */
  forkLostWork?: LostWorkSettings
  /** Fork (SLRM-1394): Claude chats keep running through an app restart. Off unless true. */
  forkChatSurvive?: boolean
  /** Fork (SLRM-1503): show which Claude account each session runs on; unset is on. */
  forkShowAccountChip?: boolean
}

/** Upstream's settings base plus the fork's settings; one hook in `global-settings-types.ts`. */
export type WithForkSettings<Base> = Base & ForkGlobalSettings
