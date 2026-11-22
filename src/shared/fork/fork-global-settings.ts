import type { ForkCustomAppThemeSettings } from './custom-app-theme/custom-app-theme-settings'
import type { LostWorkSettings } from './lost-work'
import type { ForkMemoryGlobalSettings } from './memory-truth'
import type { ForkLaunchDefaultsSettings } from './launch-defaults/launch-defaults-settings'
import type { ForkAgentColorState } from './agent-state-color'
import type { ForkMcpProfileSettings } from './mcp-profiles'
import type { ForkUsageLedgerSettings } from './usage-ledger'
import type { ForkAutoPlacementSettings } from './auto-placement'
import type { ForkServerSetupSettings } from './server-setup'
import type { ForkPooledLimitsSettings } from './pooled-limits'
import type { ForkBatchStartSettings } from './batch-start'
import type { ForkWorktreeMoveSettings } from './worktree-move/worktree-move-settings'
import type { ForkApfsCloneSettings } from './apfs-clone'
import type { ForkWebhookSettings } from './webhooks'
import type { ForkServerHealthSettings } from './server-health'
import type { ForkServerUpdateSettings } from './server-update'
import type { ForkAgentGuardSettings } from './agent-guards'
import type { ForkWorktreePortsSettings } from './worktree-ports'
import type { ForkWorktreeSnapshotSettings } from './worktree-snapshots'
import type { ForkTurnCheckpointSettings } from './turn-checkpoints'
import type { ForkPrBabysitSettings } from './pr-babysit'
import type { ForkMainSyncSettings } from './main-sync'
import type { ForkRowStatusSettings } from './row-status'
import type { ForkBranchClashSettings } from './branch-clashes'
import type { ForkReviewGuideSettings } from './review-guide'
import type { ForkDigestSettings } from './digest'
import type { ForkWorkspaceTagFilter } from './workspace-tags'
import type { ForkSavedPrompt } from './saved-prompts'
import type { ForkLettersSettings } from './letters'
import type { ForkQuickTaskSettings } from './quick-task'
import type { ForkBotStartingRulesSettings } from './bot-starting-rules'
import type { ForkInboxBotAsksSettings } from './inbox-bot-asks'
import type { ForkBotRowAskJumpSettings } from './bot-row-ask-jump'
import type { ForkBotRowBadgeSettings } from './bot-row-badges'
import type { ForkBotChatListingSettings } from './bot-chat-listing'
import type { ForkBotChatAutoCloseSettings } from './bot-chat-auto-close'
import type { ForkCardRoutingSettings } from './card-routing'
import type { ForkCompletionContractSettings } from './completion-contract'

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
  /** Fork (SLRM-2392): usage limits pooled across every account on this machine and its paired servers. */
  ForkPooledLimitsSettings &
  /** Fork (SLRM-2395): batch start from the new-workspace composer. */
  ForkBatchStartSettings &
  /** Fork (SLRM-2270): APFS clones for new worktrees on macOS. */
  ForkApfsCloneSettings &
  /** Fork (SLRM-2311): paired server health alerts and this host's heartbeat. */
  ForkServerHealthSettings &
  /** Fork (SLRM-2310): update paired servers from this desktop, and take updates as a server. */
  ForkServerUpdateSettings &
  /** Fork (SLRM-2385): the failure-loop guard and the spend cap. */
  ForkAgentGuardSettings &
  /** Fork (SLRM-2383): a block of ports per workspace, exported as ORCA_PORT and ORCA_PORT_0..N-1. */
  ForkWorktreePortsSettings &
  /** Fork (BAD-677): snapshot a worktree's work before it is removed, and for how long. */
  ForkWorktreeSnapshotSettings &
  /** Fork (BAD-678): checkpoint a workspace's files at the end of each agent turn. */
  ForkTurnCheckpointSettings &
  /** Fork (SLRM-2386): the PR babysitter; off unless a repo is listed. */
  ForkPrBabysitSettings &
  /** Fork (SLRM-2384): keep each local project's default branch current. */
  ForkMainSyncSettings &
  /** Fork (SLRM-2390): spend, context, pull request and fix button on agent rows. */
  ForkRowStatusSettings &
  /** Fork (SLRM-2394): warn when parallel worktree branches change the same files. */
  ForkBranchClashSettings &
  /** Fork (SLRM-2396): pull request review guides. */
  ForkReviewGuideSettings &
  /** Fork (SLRM-2388): the daily digest across this host and its paired servers. */
  ForkDigestSettings &
  /** Fork (SLRM-2389): letters between chats and the board of asks for the user. */
  ForkLettersSettings &
  /** Fork (SLRM-2453): bot asks in the Decision inbox, and their notice. */
  ForkInboxBotAsksSettings &
  /** Fork (SLRM-2472): a bot row's click shows its first waiting ask. */
  ForkBotRowAskJumpSettings &
  /** Fork (BAD-658): bot row count badges, an idle look, and a color per bot. */
  ForkBotRowBadgeSettings &
  /** Fork (BAD-658): bot chats with no open tab that still list under their bot. */
  ForkBotChatListingSettings &
  ForkBotChatAutoCloseSettings &
  /** Fork (SLRM-2428): the quick task box, its shortcut and the router bot. */
  ForkQuickTaskSettings &
  /** Fork (SLRM-2459): the rules a new bot's SOUL.md starts with. */
  ForkBotStartingRulesSettings &
  /** Fork (BAD-694): Linear project or team to the bot that takes its cards. */
  ForkCardRoutingSettings &
  /** Fork (BAD-676): done checks a Task can declare, and how many failed reports go back to a worker. */
  ForkCompletionContractSettings & {
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
    /** Fork (BAD-560): upstream's automatic continue after a restart also takes a person's own chats; unset is off, so only workers and automation runs carry on. */
    forkAutoContinueInteractive?: boolean
    /** Fork (SLRM-2309): chats and terminal agents stopped on a usage limit resume at the reset; unset is on. */
    forkLimitResume?: boolean
    /** Fork (SLRM-2309): also read Claude Code and Codex terminal agents for limit stops; unset is on. */
    forkLimitResumeTerminals?: boolean
    /** Fork (SLRM-2309): automatic resumes of one chat in a row (native chats at most 5); unset is 5. */
    forkLimitResumeMaxTries?: number
    /** Fork (SLRM-2309): a chat whose message box has text, or a terminal typed into since the stop, waits; unset is on. */
    forkLimitResumeHoldWhileTyping?: boolean
    /** Fork (BAD-707): the most minutes a native chat's message box text holds its automatic continue past the reset (1 to 1440); unset is 15. */
    forkLimitResumeHoldMaxMinutes?: number
    /** Fork (SLRM-2309): seconds after a terminal agent's reset before it is resumed; unset is 60. */
    forkLimitResumeDelaySeconds?: number
    /** Fork (SLRM-2309): first wait when a terminal agent names no reset, doubling per try up to 6 h; unset is 30. */
    forkLimitResumeBackoffMinutes?: number
    /** Fork (SLRM-2309): what a resumed terminal agent is told; unset is "continue". */
    forkLimitResumeMessage?: string
    /** Fork (SLRM-2309): 'dismiss' presses Esc on Codex's "Approaching rate limits" menu (keeps the model); unset is 'dismiss'. */
    forkLimitResumeCodexSwitchPrompt?: 'dismiss' | 'leave'
    /** Fork (SLRM-2391): hand a native chat from Claude to Codex or back, from its tab menu and `orca chat handoff`; unset is on. */
    forkChatHandoff?: boolean
    /** Fork (SLRM-2391): tokens of history a handoff carries, charged one per UTF-8 byte (1024 to 64000); unset is 16000. */
    forkChatHandoffBudgetTokens?: number
    /** Fork (SLRM-2391): handing back to the agent the work came from continues that chat while its context has room; unset is on. */
    forkChatHandoffReuse?: boolean
    /** Fork (SLRM-2391): when a chat stops on a usage limit: 'offer' a handoff in a toast, 'auto' hands it off at once, 'off' does neither; unset is 'offer'. */
    forkChatHandoffOnLimit?: 'off' | 'offer' | 'auto'
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
    /** Fork worker archive (BAD-669): archive finished workers' own workspaces once they hold no unmerged or uncommitted work; unset is on. */
    forkWorkerArchive?: boolean
    /** Fork worker archive: minutes after a worker finishes before its workspace is archived; unset is 120. */
    forkWorkerArchiveDelayMinutes?: number
    /** Fork worker archive: minutes after a worker reports before its idle terminal or agent is stopped; unset is 15. */
    forkWorkerTerminalStopMinutes?: number
    /** Fork launch defaults: model and effort per launch kind (cli, worker, automation, bot for new bots) and agent; empty is stock. */
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
    /** Fork approval triage (SLRM-2397): approval cards show a low, medium or high risk grade, and high risk cannot be allowed for the session. Off unless true. */
    forkApprovalRisk?: boolean
    /** Fork approval triage (SLRM-2397): a coordinator chat offers to allow every low risk worker approval at once. Off unless true. */
    forkApprovalBulkAllowLow?: boolean
    /** Fork workspace tags (SLRM-2397): tag workspaces and filter the sidebar by a tag; unset is on. */
    forkWorkspaceTagsEnabled?: boolean
    /** Fork workspace tags: each workspace's tags, keyed by workspace id and host; unset is none. Set them from the workspace menu. */
    forkWorkspaceTags?: Record<string, string[]>
    /** Fork workspace tags: the sidebar's tag filter, 'only' shows that tag and 'hide' hides it; unset is none. */
    forkWorkspaceTagFilter?: ForkWorkspaceTagFilter | null
    /** Fork archive on merge (SLRM-2397): archive a workspace once its pull request merges, through the stock archive. Off unless true. */
    forkArchiveOnMerge?: boolean
    /** Fork prompt stash (SLRM-2397): Cmd+S (Ctrl+S) in a chat's message box sets the draft and its attachments aside, and brings the last one back when the box is empty; unset is on. */
    forkPromptStash?: boolean
    /** Fork saved prompts (SLRM-2397): a saved prompts menu on the chat message box; unset is on. */
    forkSavedPromptsEnabled?: boolean
    /** Fork saved prompts: the saved prompts, each a label and its text; unset is none. */
    forkSavedPrompts?: ForkSavedPrompt[]
    /** Fork snooze: a command run once when a snooze settles (its pull request merged or its idle days passed); unset is none. Set it in the Settings screen. */
    forkSnoozeSettleCommand?: string
    /** Fork best of N (SLRM-2393): `orca best-of` and the compare view; unset is on. */
    forkBestOf?: boolean
    /** Fork best of N: default agents of the attempts, agent[:model[:effort]] comma separated and cycled; unset is claude. */
    forkBestOfAgents?: string
    /** Fork best of N: default machines of the attempts, auto, here or server names, comma separated and cycled; unset is auto. */
    forkBestOfPlacement?: string
    /** Fork best of N: what a pick does with the worktrees of the attempts that lost; unset is 'archive'. */
    forkBestOfLoserAction?: 'archive' | 'remove' | 'keep'
    /** Fork best of N: how many runs the compare view keeps; unset is 20. */
    forkBestOfHistory?: number
    /** Fork best of N: the note added to every attempt's prompt, {{index}} and {{count}} filled in; unset is the built-in note. Set it in the Settings screen. */
    forkBestOfAttemptNote?: string
  }

/** Upstream's settings base plus the fork's settings; one hook in `global-settings-types.ts`. */
export type WithForkSettings<Base> = Base & ForkGlobalSettings
