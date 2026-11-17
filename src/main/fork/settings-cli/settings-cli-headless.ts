// Settings from the CLI (FORK.md) on a host with no desktop app (`orca serve`): there is no
// `settings:set` handler to write through, so `orca settings` writes the host's own settings
// store, with the stored-value rules of that handler that need no window. The store's change
// listeners (agent hooks, the fork's services) hear the write as they hear any other. A setting
// only the desktop app can act on is refused by name. Keep electron out of this file.
import type { GlobalSettings } from '../../../shared/settings/global-settings-types'
import { resolveAiVaultSearchSettings } from '../../../shared/ai-vault/search/ai-vault-search-settings'
import {
  normalizeMobilePairingCustomAddress,
  normalizeMobilePairingCustomAddresses
} from '../../../shared/remote-runtime/pairing/mobile-pairing-custom-address'
import { normalizeTerminalCustomThemes } from '../../../shared/terminal-themes/terminal-custom-themes'
import { normalizeTerminalLineHeight } from '../../../shared/terminal/appearance/terminal-line-height-settings'
import { normalizeDesktopTerminalScrollbackRows } from '../../../shared/terminal/replay/terminal-scrollback-policy'
import { sanitizeNetworkSettings } from '../../ipc/settings/network-settings-sanitization'
import { sanitizeRendererSettingsUpdate } from '../../ipc/settings/renderer-settings-update'

type SettingsKey = keyof GlobalSettings

const LOOK = "it changes the desktop app's own look or language"
const AWAKE = 'the desktop app is what keeps a computer awake'

/** Settings whose whole effect is in the desktop app: stored here they would do nothing. */
const DESKTOP_ONLY: Partial<Record<SettingsKey, string>> = {
  theme: LOOK,
  appIcon: LOOK,
  uiLanguage: LOOK,
  computerAwakeMode: AWAKE,
  keepComputerAwakeWhileAgentsRun: AWAKE,
  floatingTerminalCwd: "the folder is granted by the desktop app's folder picker",
  forkChatSurvive:
    'chat survive runs only in the desktop app; a server keeps its chats through a desktop restart without it'
}

let headless = false

/** Called once by a host that runs without the desktop app, before its RPC server starts. */
export function forkMarkHeadlessSettingsHost(value = true): void {
  headless = value
}

export function forkIsHeadlessSettingsHost(): boolean {
  return headless
}

/** Why a host with no desktop app refuses to write `key`, or null when it writes it. */
export function forkHeadlessSettingRefusal(key: string): string | null {
  const reason = (DESKTOP_ONLY as Record<string, string | undefined>)[key]
  return reason ? `not on a server without the desktop app: ${reason}` : null
}

export const FORK_HEADLESS_REFUSED_SETTING_KEYS: readonly string[] = Object.keys(DESKTOP_ONLY)

/** The update as it may be stored: the window-free rules of the `settings:set` handler. */
export function forkSanitizeHeadlessSettingsUpdate(
  args: Partial<GlobalSettings>
): Partial<GlobalSettings> {
  const sanitized = sanitizeRendererSettingsUpdate(args)
  delete sanitized.activeRuntimeEnvironmentId
  delete sanitized.floatingTerminalTrustedCwds
  delete sanitized.browserPasswordsFillRequiresReauth
  for (const key of FORK_HEADLESS_REFUSED_SETTING_KEYS) {
    delete (sanitized as Record<string, unknown>)[key]
  }
  sanitizeNetworkSettings(args, sanitized)
  if ('aiVaultSearch' in args) {
    sanitized.aiVaultSearch = resolveAiVaultSearchSettings(args)
  }
  if ('terminalCustomThemes' in args) {
    sanitized.terminalCustomThemes = normalizeTerminalCustomThemes(args.terminalCustomThemes)
  }
  if ('terminalScrollbackRows' in args) {
    sanitized.terminalScrollbackRows = normalizeDesktopTerminalScrollbackRows(
      args.terminalScrollbackRows
    )
  }
  if ('terminalLineHeight' in args) {
    sanitized.terminalLineHeight = normalizeTerminalLineHeight(args.terminalLineHeight)
  }
  if ('mobilePairingCustomAddress' in args) {
    sanitized.mobilePairingCustomAddress = normalizeMobilePairingCustomAddress(
      args.mobilePairingCustomAddress
    )
  }
  if ('mobilePairingCustomAddresses' in args) {
    sanitized.mobilePairingCustomAddresses = normalizeMobilePairingCustomAddresses(
      args.mobilePairingCustomAddresses
    )
  }
  return sanitized
}

export type ForkHeadlessSettingsStore = {
  updateSettings?: (
    updates: Partial<GlobalSettings>,
    options?: { notifyListeners?: boolean }
  ) => unknown
  updateSettingsAndFlush?: (
    updates: Partial<GlobalSettings>,
    options?: { notifyListeners?: boolean }
  ) => Promise<unknown>
}

/**
 * Writes an update to the host's settings store and tells its listeners. Where the store can,
 * the write is on disk before this resolves, so a restart right after the reply keeps it.
 */
export async function forkApplyHeadlessSettings(
  store: ForkHeadlessSettingsStore,
  update: Record<string, unknown>
): Promise<void> {
  const sanitized = forkSanitizeHeadlessSettingsUpdate(update as Partial<GlobalSettings>)
  if (Object.keys(sanitized).length === 0) {
    return
  }
  if (store.updateSettingsAndFlush) {
    await store.updateSettingsAndFlush(sanitized, { notifyListeners: true })
    return
  }
  if (!store.updateSettings) {
    throw new Error('This host has no settings store to write to.')
  }
  store.updateSettings(sanitized, { notifyListeners: true })
}
