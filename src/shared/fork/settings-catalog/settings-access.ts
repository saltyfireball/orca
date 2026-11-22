// Settings from the CLI (FORK.md): which settings `orca settings` may not write and which it
// may not show. Every key here is typed against `GlobalSettings`, so a renamed or removed
// setting fails the type check instead of silently losing its guard.
import type { GlobalSettings } from '../../settings/global-settings-types'

type SettingsKey = keyof GlobalSettings

export type ForkSettingReadOnlyKind =
  | 'guarded'
  | 'owner-confirm'
  | 'agent-limit'
  | 'account'
  | 'marker'
  | 'runs-command'

const REASON: Record<ForkSettingReadOnlyKind, string> = {
  'runs-command':
    'the app runs this command or calls this address with your rights, and agents run this CLI; set it in the Settings screen',
  guarded:
    'the app drops this key from a general settings write; it changes only through its own screen or command',
  'owner-confirm': 'changing it needs the confirmation the Settings screen asks for',
  'agent-limit':
    'it limits what agents may do, and agents run this CLI; change it in the Settings screen',
  account: 'accounts are added, removed and switched with `orca account` or the Accounts screen',
  marker: 'the app keeps this one-time marker itself'
}

/** The keys the `settings:set` handler deletes from every update it is given. */
const GUARDED: SettingsKey[] = [
  'activeRuntimeEnvironmentId',
  'floatingTerminalTrustedCwds',
  'antigravityChatAuth',
  'pluginConsents',
  'disabledPlugins',
  'pluginExternalHostGrants'
]

/** Turning it off raises a system authentication prompt; the CLI does not raise prompts. */
const OWNER_CONFIRM: SettingsKey[] = ['browserPasswordsFillRequiresReauth']

/** Caps and gates on agents, which upstream keeps out of its CLI settings method. */
const AGENT_LIMITS: SettingsKey[] = [
  'nestedWorkerMaxDepth',
  'artifactSharingEnabled',
  'agentSkillSharingEnabled',
  'orchestrationCoordinatorApprovalsEnabled',
  // SLRM-2397: approval triage's grade and bulk allow, archive on merge (removes checkouts), and
  // the saved prompts a person sends: an agent must not set what answers or speaks for the person.
  'forkApprovalRisk',
  'forkApprovalBulkAllowLow',
  'forkArchiveOnMerge',
  'forkSavedPrompts',
  // SLRM-2389: the letter and board rate limits agents would otherwise raise for themselves.
  'forkLettersMaxPerWindow',
  'forkLettersWindowMinutes',
  'forkLettersLoopEach',
  'forkLettersFromPaired',
  'forkBoardMaxOpenPerChat',
  // SLRM-2411: continuing a person's own chats after a restart answers the restart offer for them.
  'forkUnattendedResumeInteractive',
  // SLRM-2428: the bot every quick task goes to first; an agent must not redirect the owner's tasks.
  'forkQuickTaskRouterBot',
  // SLRM-2459: the rules every new bot starts with; an agent must not loosen them for the bots it makes.
  'forkBotStartingRules'
]

const ACCOUNTS: SettingsKey[] = [
  'claudeManagedAccounts',
  'codexManagedAccounts',
  'activeClaudeManagedAccountId',
  'activeClaudeManagedAccountIdsByRuntime',
  'activeCodexManagedAccountId',
  'activeCodexManagedAccountIdsByRuntime'
]

/** Commands and addresses the app runs or calls (idle recovery, snooze): a write here is code execution. */
const RUNS_COMMAND: SettingsKey[] = [
  'forkIdleSweepClassifierCommand',
  'forkInboxNotifyCommand',
  'forkInboxNotifyWebhookUrl',
  // SLRM-2269: the snooze settle cleanup command.
  'forkSnoozeSettleCommand',
  // SLRM-2311: whether server health alerts run the notification command.
  'forkServerHealthAlertCommand',
  // SLRM-2388: whether the daily digest runs the notification command.
  'forkDigestCommand',
  // SLRM-2428: the command the quick task router runs to rank machines.
  'forkQuickTaskPlacementCommand',
  // SLRM-2309: the text typed into every terminal agent resumed after a usage limit.
  'forkLimitResumeMessage',
  // SLRM-2310: where a server downloads new code from, and whose signature it accepts.
  'forkServerUpdateReleasesUrl',
  'forkServerUpdateMacCertSha1',
  'forkServerUpdateMacTeamId',
  // SLRM-2393: the text added to the prompt of every best-of attempt.
  'forkBestOfAttemptNote'
]

/** One-time migration and "already defaulted" markers. */
const MARKERS: SettingsKey[] = [
  'agentWorkspaceTrustExistingReposMigrated',
  'agentYoloDefaultsMigrated',
  'agentsSidebarIntroShown',
  'agentsSidebarMigratedFromExperimental',
  'autoRenameBranchFromWorkDefaultedOn',
  'claudeAgentTeamsDefaultDisabledMigrated',
  'experimentalActivityDefaultedOffForAllUsers',
  'floatingTerminalCwdMigratedToAppWorkspace',
  'floatingTerminalDefaultedForAllUsers',
  'localAccountRuntimeDefaultedToAutoForAllUsers',
  'nativeChatAutoContinueAfterUsageLimitDefaultedOn',
  'nestedWorkerMaxDepthDefaultedToFour',
  'nonMacSearchKeybindingSeed',
  'pluginSystemDefaultedOn',
  'primarySelectionMiddleClickPasteDefaultedForLinux',
  'primarySelectionMiddleClickPasteDefaultedForTerminalDefaults',
  'searchKeybindingSeed',
  'sshRemoteCliControlExistingHostsMigrated',
  'tabSwitchKeybindingSeed',
  'terminalAllowOsc52ClipboardDefaultedOnForAllUsers',
  'terminalCursorStyleDefaultedToBlock',
  'terminalMacOptionAsAltMigrated',
  'terminalRightClickToPasteDefaultedForPlatform',
  'terminalTuiScrollSensitivityDefaultedToOne',
  'uiLanguagePortugueseMigrationApplied',
  'visibleTaskProvidersDefaultedForJira',
  'voiceDictationModeDefaultedToAuto'
]

const READ_ONLY = new Map<string, ForkSettingReadOnlyKind>([
  ...GUARDED.map((key) => [key, 'guarded'] as const),
  ...OWNER_CONFIRM.map((key) => [key, 'owner-confirm'] as const),
  ...AGENT_LIMITS.map((key) => [key, 'agent-limit'] as const),
  ...ACCOUNTS.map((key) => [key, 'account'] as const),
  ...MARKERS.map((key) => [key, 'marker'] as const),
  ...RUNS_COMMAND.map((key) => [key, 'runs-command'] as const)
])

/**
 * Settings whose value is, or may carry, a credential: a session cookie, a proxy URL with a
 * user and password in it, per-agent environment values (API keys), and a webhook address
 * (its path or query is usually the token that lets anyone post to it). `orca settings` says
 * whether each is set and never prints, exports or returns the value.
 */
const SECRETS: SettingsKey[] = [
  'opencodeSessionCookie',
  'httpProxyUrl',
  'agentDefaultEnv',
  'forkInboxNotifyWebhookUrl',
  // SLRM-2311: a heartbeat address usually carries the monitor's check token.
  'forkServerHeartbeatUrl'
]
const SECRET_SET: ReadonlySet<string> = new Set(SECRETS)

export const FORK_SETTINGS_SECRET_KEYS: readonly string[] = SECRETS
export const FORK_SETTINGS_READ_ONLY_KEYS: readonly string[] = [...READ_ONLY.keys()]

/** Why `orca settings` refuses to write `key`, or null when it may. */
export function forkSettingReadOnlyReason(key: string): string | null {
  const kind = READ_ONLY.get(key)
  return kind ? REASON[kind] : null
}

export function isForkSettingSecret(key: string): boolean {
  return SECRET_SET.has(key)
}

/** Whether a secret setting holds anything: an empty string or object counts as not set. */
export function isForkSecretValueSet(value: unknown): boolean {
  if (value === undefined || value === null || value === '') {
    return false
  }
  return typeof value === 'object' ? Object.keys(value).length > 0 : true
}
