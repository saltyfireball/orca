// Settings from the CLI (FORK.md): which settings `orca settings` may not write and which it
// may not show. Every key here is typed against `GlobalSettings`, so a renamed or removed
// setting fails the type check instead of silently losing its guard.
import type { GlobalSettings } from '../../global-settings-types'

type SettingsKey = keyof GlobalSettings

export type ForkSettingReadOnlyKind =
  | 'guarded'
  | 'owner-confirm'
  | 'agent-limit'
  | 'account'
  | 'marker'

const REASON: Record<ForkSettingReadOnlyKind, string> = {
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
  'agentSkillSharingEnabled'
]

const ACCOUNTS: SettingsKey[] = [
  'claudeManagedAccounts',
  'codexManagedAccounts',
  'activeClaudeManagedAccountId',
  'activeClaudeManagedAccountIdsByRuntime',
  'activeCodexManagedAccountId',
  'activeCodexManagedAccountIdsByRuntime'
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
  ...MARKERS.map((key) => [key, 'marker'] as const)
])

/**
 * Settings whose value is, or may carry, a credential: a session cookie, a proxy URL with a
 * user and password in it, and per-agent environment values (API keys). `orca settings` says
 * whether each is set and never prints, exports or returns the value.
 */
const SECRETS: SettingsKey[] = ['opencodeSessionCookie', 'httpProxyUrl', 'agentDefaultEnv']
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
