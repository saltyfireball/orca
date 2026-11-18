import type { ForkCustomAppThemeSettings } from './custom-app-theme/custom-app-theme-settings'
import type { LostWorkSettings } from './lost-work'
import type { ForkMemoryGlobalSettings } from './memory-truth'
import type { ForkLaunchDefaultsSettings } from './launch-defaults/launch-defaults-settings'
import type { ForkAgentColorState } from './agent-state-color'
import type { ForkMcpProfileSettings } from './mcp-profiles'
import type { ForkUsageLedgerSettings } from './usage-ledger'
import type { ForkAutoPlacementSettings } from './auto-placement'
import type { ForkServerSetupSettings } from './server-setup'
import type { ForkBatchStartSettings } from './batch-start'
import type { ForkPooledLimitsSettings } from './pooled-limits'
import type { ForkWorktreeMoveSettings } from './worktree-move/worktree-move-settings'
import type { ForkApfsCloneSettings } from './apfs-clone'
import type { ForkWebhookSettings } from './webhooks'
import type { ForkServerHealthSettings } from './server-health'
import type { ForkServerUpdateSettings } from './server-update'
import type { ForkPrBabysitSettings } from './pr-babysit'
import type { ForkWorktreePortsSettings } from './worktree-ports'
import type { ForkRowStatusSettings } from './row-status'
import type { ForkMainSyncSettings } from './main-sync'

/** Fork-only settings, kept out of the upstream settings type so it stays under its line budget. */
export type ForkGlobalSettings = ForkCustomAppThemeSettings &
  ForkMemoryGlobalSettings &
  /** Fork: MCP profiles and their defaults; unset is "all" everywhere. */
  ForkMcpProfileSettings &
  ForkUsageLedgerSettings &
  /** Fork (SLRM-2266): per-machine placement and auto placement when no machine is named. */
  ForkAutoPlacementSettings &
  /** Fork (SLRM-2312): set a project up on a paired server that lacks it. */
  ForkServerSetupSettings &
  /** Fork (SLRM-2395): batch start from the new-workspace composer. */
  ForkBatchStartSettings &
  /** Fork (SLRM-2392): usage limits pooled across every account on this machine and its paired servers. */
  ForkPooledLimitsSettings &
  /** Fork (SLRM-2270): APFS clones for new worktrees on macOS. */
  ForkApfsCloneSettings &
  /** Fork (SLRM-2311): paired server health alerts and this host's heartbeat. */
  ForkServerHealthSettings &
  /** Fork (SLRM-2310): update paired servers from this desktop, and take updates as a server. */
  ForkServerUpdateSettings &
  /** Fork (SLRM-2386): the PR babysitter; off unless a repo is listed. */
  ForkPrBabysitSettings &
  /** Fork (SLRM-2383): a block of ports per workspace, exported as ORCA_PORT and ORCA_PORT_0..N-1. */
  ForkWorktreePortsSettings & {
  /** Fork (SLRM-2390): spend, context, pull request and fix button on agent rows. */
  ForkRowStatusSettings & {
  /** Fork (SLRM-2384): keep each local project's default branch current. */
  ForkMainSyncSettings & {
    /** Fork (SLRM-2096): the lost work scan's checks, base branches and archive folder. */
    forkLostWork?: LostWorkSettings
    /** Fork (SLRM-2265): moving a workspace and its chats to another host; unset keys take the defaults. */
    forkWorktreeMove?: ForkWorktreeMoveSettings
    /** Fork (SLRM-2271): a newly paired device needs approval from an approved device or this host's owner. Off unless true. */
    forkDeviceApproval?: boolean
    /** Fork (SLRM-2271): signed webhooks that start automation runs; off unless enabled is true. */
    forkWebhooks?: ForkWebhookSettings
    /** Fork (SLRM-2349): ::orca-visual also shows png, jpg, gif and webp files and takes unquoted values; unset is on. */
    forkVisualFallback?: boolean
    /** Fork (SLRM-2349): largest image file ::orca-visual shows, in MiB (1 to 5); unset is 4. */
    forkVisualImageMaxMiB?: number
    /** Fork (SLRM-1394): Claude chats keep running through an app restart. Off unless true. */
    forkChatSurvive?: boolean
    /** Fork (SLRM-2268): workers and automation runs a restart cut carry on by themselves; unset is on. */
    forkUnattendedResume?: boolean
    /** Fork (SLRM-2268): automatic continuations of one chat in a row; unset is 3. */
    forkUnattendedResumeMaxTries?: number
    /** Fork (SLRM-2309): chats and terminal agents stopped on a usage limit resume at the reset; unset is on. */
    forkLimitResume?: boolean
    /** Fork (SLRM-2309): also read Claude Code and Codex terminal agents for limit stops; unset is on. */
    forkLimitResumeTerminals?: boolean
    /** Fork (SLRM-2309): automatic resumes of one chat in a row (native chats at most 5); unset is 5. */
    forkLimitResumeMaxTries?: number
    /** Fork (SLRM-2309): a chat whose message box has text, or a terminal typed into since the stop, waits; unset is on. */
    forkLimitResumeHoldWhileTyping?: boolean
    /** Fork (SLRM-2309): seconds after a terminal agent's reset before it is resumed; unset is 60. */
    forkLimitResumeDelaySeconds?: number
    /** Fork (SLRM-2309): first wait when a terminal agent names no reset, doubling per try up to 6 h; unset is 30. */
    forkLimitResumeBackoffMinutes?: number
    /** Fork (SLRM-2309): what a resumed terminal agent is told; unset is "continue". */
    forkLimitResumeMessage?: string
    /** Fork (SLRM-2309): 'dismiss' presses Esc on Codex's "Approaching rate limits" menu (keeps the model); unset is 'dismiss'. */
    forkLimitResumeCodexSwitchPrompt?: 'dismiss' | 'leave'
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
    /** Fork sync status: say when the fork is behind upstream or its last sync failed; unset is on. */
    forkSyncNotice?: boolean
    /** Fork sync status: days without a new status before it is called stale; unset is 3, 0 is off. */
    forkSyncNoticeStaleDays?: number
    /** Fork idle recovery: 'off', 'inbox' (list chats waiting on you) or 'wake' (also wake stalled chats); unset is 'off'. */
    forkIdleSweepMode?: 'off' | 'inbox' | 'wake'
    /** Fork idle recovery: seconds a chat sits idle after its turn before its ending is judged; unset is 45. */
    forkIdleSweepIdleSeconds?: number
    /** Fork idle recovery: the command that judges an ending (JSON on stdin, a JSON verdict on stdout); unset uses the built-in check. Set it in the Settings screen. */
    forkIdleSweepClassifierCommand?: string
    /** Fork idle recovery: seconds the classifier command may run; unset is 30. */
    forkIdleSweepClassifierTimeoutSeconds?: number
    /** Fork idle recovery: most wake messages sent to a chat for one request; unset is 2. */
    forkIdleSweepMaxWakes?: number
    /** Fork idle recovery: longest wait, in minutes, a verdict may ask for before the next look; unset is 60. */
    forkIdleSweepRecheckMaxMinutes?: number
    /** Fork idle recovery: 'skip' leaves orchestration workers alone, 'include' judges them too; unset is 'skip'. */
    forkIdleSweepWorkers?: 'skip' | 'include'
    /** Fork idle recovery: chat ids it leaves alone; unset is none. */
    forkIdleSweepPaused?: string[]
    /** Fork decision inbox: show a desktop notification when a chat starts waiting on you. Off unless true. */
    forkInboxNotifyDesktop?: boolean
    /** Fork decision inbox: an http(s) address that gets a POST when a chat starts waiting on you; unset is none. Set it in the Settings screen. */
    forkInboxNotifyWebhookUrl?: string
    /** Fork decision inbox: a command run when a chat starts waiting on you; unset is none. Set it in the Settings screen. */
    forkInboxNotifyCommand?: string
    /** Fork boundary compaction: 'on' asks an idle native chat to compact between turns once its context is large; unset is 'off'. */
    forkBoundaryCompactMode?: 'off' | 'on'
    /** Fork boundary compaction: context size, in tokens, from which a chat is compacted; unset is 120000. */
    forkBoundaryCompactThresholdTokens?: number
    /** Fork boundary compaction: seconds a chat rests after its turn before it may be compacted; unset is 120. */
    forkBoundaryCompactIdleSeconds?: number
    /** Fork boundary compaction: wait until the chat's prompt cache has expired; unset is on. */
    forkBoundaryCompactPreferCold?: boolean
    /** Fork boundary compaction: minutes of rest after which a chat is compacted even on a warm cache; unset is 20. */
    forkBoundaryCompactMaxWaitMinutes?: number
    /** Fork endpoint failover: try a saved server's other routes when one stops answering, and move back to a better one; unset is on. */
    forkEndpointFailover?: boolean
    /** Fork endpoint failover: seconds between tries of a better route while on a worse one; unset is 60. */
    forkEndpointFailoverRetrySeconds?: number
    /** Fork endpoint failover: ask a Blackfish server for its current LAN and Tailscale addresses; unset is on. */
    forkEndpointLearnAddresses?: boolean
    /** Fork endpoint failover: use a learned address only when it is in a saved endpoint's /24 or is a Tailscale address; unset is on. */
    forkEndpointLearnSameSubnetOnly?: boolean
    /** Fork snooze (SLRM-2269): snooze workspaces and chats out of the sidebar; unset is on. */
    forkSnooze?: boolean
    /** Fork snooze: a snoozed workspace or chat comes back when it needs an approval or asks a question; unset is on. */
    forkSnoozeWakeOnAttention?: boolean
    /** Fork snooze: a snoozed workspace or chat comes back when its agent fails or errors; unset is on. */
    forkSnoozeWakeOnFailure?: boolean
    /** Fork snooze: opening a snoozed workspace or chat wakes it; unset is on. */
    forkSnoozeWakeOnOpen?: boolean
    /** Fork snooze: the hour (0-23) of the tomorrow and next Monday morning presets; unset is 9. */
    forkSnoozeMorningHour?: number
    /** Fork snooze: the hour (0-23) of the this evening preset; unset is 18. */
    forkSnoozeEveningHour?: number
    /** Fork snooze: the idle days of the menu's until idle choice; unset is 3. */
    forkSnoozeIdleDays?: number
    /** Fork snooze: a command run once when a snooze settles (its pull request merged or its idle days passed); unset is none. Set it in the Settings screen. */
    forkSnoozeSettleCommand?: string
  }

/** Upstream's settings base plus the fork's settings; one hook in `global-settings-types.ts`. */
export type WithForkSettings<Base> = Base & ForkGlobalSettings
