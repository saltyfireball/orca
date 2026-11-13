import type { ForkCustomAppThemeSettings } from './custom-app-theme/custom-app-theme-settings'
import type { LostWorkSettings } from './lost-work'
import type { ForkMemoryGlobalSettings } from './memory-truth'
import type { ForkLaunchDefaultsSettings } from './launch-defaults/launch-defaults-settings'
import type { ForkAgentColorState } from './agent-state-color'
import type { ForkMcpProfileSettings } from './mcp-profiles'
import type { ForkUsageLedgerSettings } from './usage-ledger'

/** Fork-only settings, kept out of the upstream settings type so it stays under its line budget. */
export type ForkGlobalSettings = ForkCustomAppThemeSettings &
  ForkMemoryGlobalSettings &
  /** Fork: MCP profiles and their defaults; unset is "all" everywhere. */
  ForkMcpProfileSettings &
  ForkUsageLedgerSettings & {
    /** Fork (SLRM-2096): the lost work scan's checks, base branches and archive folder. */
    forkLostWork?: LostWorkSettings
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
    /** Fork chat sleep: idle native chats give up their provider process. Off unless true. */
    forkChatSleep?: boolean
    /** Fork chat sleep: minutes a chat sits idle before it sleeps; unset is 30. */
    forkChatSleepIdleMinutes?: number
    /** Fork chat sleep: chats on screen never sleep; unset is on. */
    forkChatSleepKeepVisible?: boolean
    /** Fork (SLRM-2098): limit how many agents run at once and queue the rest. Off unless true. */
    forkAgentQueueEnabled?: boolean
    /** Fork (SLRM-2098): most agents running at once (all, or user-started when separate); unset is 8. */
    forkAgentQueueMaxLive?: number
    /** Fork (SLRM-2098): orchestration workers get their own limit; unset is one shared limit. */
    forkAgentQueueSeparateLimits?: boolean
    /** Fork (SLRM-2098): most orchestration workers running at once when separate; unset is 8. */
    forkAgentQueueMaxWorkers?: number
    /** Fork (SLRM-2098): waking an existing chat never waits, even past the limit; unset is on. */
    forkAgentQueueResumeBypass?: boolean
    /** Fork chat stall: minutes without provider output before an open turn is marked stalled;
     *  unset is 30, 0 is off. */
    forkChatStallMinutes?: number
    /** Fork chat stall: release a long-stalled chat whose provider is stopped or gone. Off unless true. */
    forkChatStallAutoRelease?: boolean
    /** Fork worker cleanup: finished workers give up their agent, replacing the stock auto-release. Off unless true. */
    forkWorkerCleanup?: boolean
    /** Fork worker cleanup: minutes after a worker reports before it is cleaned up; unset is 5. */
    forkWorkerCleanupGraceMinutes?: number
    /** Fork worker cleanup: 'close' closes the tab, 'release' keeps a chat's tab; unset is 'close'. */
    forkWorkerCleanupAction?: 'close' | 'release'
    /** Fork worker cleanup: clean up once the worker reports done; unset is on. */
    forkWorkerCleanupOnDone?: boolean
    /** Fork worker cleanup: clean up once the worker's branch is merged; unset is off. */
    forkWorkerCleanupOnMerged?: boolean
    /** Fork launch defaults: model and effort per launch kind and agent; empty is stock. */
    forkLaunchDefaults?: ForkLaunchDefaultsSettings
    /** Fork sleepers: native chat session ids that never auto-sleep; unset is none. */
    forkSleepersPinned?: string[]
    /** Fork agent state colors: color tabs and agent rows by agent state. Off unless true. */
    forkAgentStateColors?: boolean
    /** Fork agent state colors: 'tab', 'row' or 'both'; unset is 'both'. */
    forkAgentStateColorsWhere?: 'both' | 'tab' | 'row'
    /** Fork agent state colors: 'accent' (edge stripe) or 'tint' (stripe and wash); unset is 'accent'. */
    forkAgentStateColorsStrength?: 'accent' | 'tint'
    /** Fork agent state colors: per state 'none', a theme color id or a hex; unset keys use defaults. */
    forkAgentStateColorsByState?: Partial<Record<ForkAgentColorState, string>>
    /** Fork sleepers: the sidebar toolbar's Sleepers button; unset is shown. */
    forkSleepersButton?: boolean
  }

/** Upstream's settings base plus the fork's settings; one hook in `global-settings-types.ts`. */
export type WithForkSettings<Base> = Base & ForkGlobalSettings
