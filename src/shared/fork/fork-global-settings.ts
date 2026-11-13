import type { ForkMemoryGlobalSettings } from './memory-truth'

/** Fork-only settings, kept out of the upstream settings type so it stays under its line budget.
 *  SLRM-2099 adds the memory warning settings (`forkMemory*`, see memory-truth.ts). */
export type ForkGlobalSettings = ForkMemoryGlobalSettings & {
  /** Fork (SLRM-1394): Claude chats keep running through an app restart. Off unless true. */
  forkChatSurvive?: boolean
  /** Fork (SLRM-1503): show which Claude account each session runs on; unset is on. */
  forkShowAccountChip?: boolean
}

/** Upstream's settings base plus the fork's settings; one hook in `global-settings-types.ts`. */
export type WithForkSettings<Base> = Base & ForkGlobalSettings
