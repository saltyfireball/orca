// Idle recovery (FORK.md): its settings, read from any settings object with their defaults and
// limits applied. Everything ships off: mode 'off', no classifier command, no notification.
import type { ForkGlobalSettings } from './fork-global-settings'

export type IdleRecoveryMode = 'off' | 'inbox' | 'wake'
export type IdleRecoveryWorkers = 'skip' | 'include'

export const IDLE_RECOVERY_DEFAULT_IDLE_SECONDS = 45
export const IDLE_RECOVERY_DEFAULT_CLASSIFIER_TIMEOUT_SECONDS = 30
export const IDLE_RECOVERY_DEFAULT_MAX_WAKES = 2
export const IDLE_RECOVERY_DEFAULT_RECHECK_MAX_MINUTES = 60
/** Most chats the paused list keeps; the oldest are dropped first. */
export const IDLE_RECOVERY_MAX_PAUSED = 500
const MAX_COMMAND_CHARS = 4000
const MAX_URL_CHARS = 2000
const MAX_CHAT_ID_CHARS = 512

export type IdleRecoverySettings = {
  mode: IdleRecoveryMode
  idleSeconds: number
  /** The user's classifier command, or null for the built-in classifier. */
  classifierCommand: string | null
  classifierTimeoutSeconds: number
  maxWakes: number
  recheckMaxMinutes: number
  workers: IdleRecoveryWorkers
  paused: string[]
  notifyDesktop: boolean
  notifyWebhookUrl: string | null
  notifyCommand: string | null
}

type SettingKey =
  | 'forkIdleSweepMode'
  | 'forkIdleSweepIdleSeconds'
  | 'forkIdleSweepClassifierCommand'
  | 'forkIdleSweepClassifierTimeoutSeconds'
  | 'forkIdleSweepMaxWakes'
  | 'forkIdleSweepRecheckMaxMinutes'
  | 'forkIdleSweepWorkers'
  | 'forkIdleSweepPaused'
  | 'forkInboxNotifyDesktop'
  | 'forkInboxNotifyWebhookUrl'
  | 'forkInboxNotifyCommand'

/** Any settings object; values are checked here, so a hand-edited file cannot break a reader. */
export type IdleRecoverySettingsSource = Partial<Record<SettingKey, unknown>> | null | undefined

function field(settings: IdleRecoverySettingsSource, key: SettingKey): unknown {
  return settings ? settings[key] : undefined
}

function wholeNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback
}

function text(value: unknown, maxChars: number): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed && trimmed.length <= maxChars ? trimmed : null
}

function webhookUrl(value: unknown): string | null {
  const url = text(value, MAX_URL_CHARS)
  return url && /^https?:\/\/\S+$/i.test(url) ? url : null
}

export function normalizeIdleRecoveryPaused(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const kept = new Set<string>()
  for (const id of value) {
    if (typeof id === 'string' && id.length > 0 && id.length <= MAX_CHAT_ID_CHARS) {
      kept.add(id)
    }
  }
  return [...kept].slice(-IDLE_RECOVERY_MAX_PAUSED)
}

export function readIdleRecoverySettings(
  settings: IdleRecoverySettingsSource
): IdleRecoverySettings {
  const mode = field(settings, 'forkIdleSweepMode')
  return {
    mode: mode === 'inbox' || mode === 'wake' ? mode : 'off',
    idleSeconds: wholeNumber(
      field(settings, 'forkIdleSweepIdleSeconds'),
      10,
      24 * 60 * 60,
      IDLE_RECOVERY_DEFAULT_IDLE_SECONDS
    ),
    classifierCommand: text(field(settings, 'forkIdleSweepClassifierCommand'), MAX_COMMAND_CHARS),
    classifierTimeoutSeconds: wholeNumber(
      field(settings, 'forkIdleSweepClassifierTimeoutSeconds'),
      1,
      600,
      IDLE_RECOVERY_DEFAULT_CLASSIFIER_TIMEOUT_SECONDS
    ),
    maxWakes: wholeNumber(
      field(settings, 'forkIdleSweepMaxWakes'),
      0,
      20,
      IDLE_RECOVERY_DEFAULT_MAX_WAKES
    ),
    recheckMaxMinutes: wholeNumber(
      field(settings, 'forkIdleSweepRecheckMaxMinutes'),
      1,
      24 * 60,
      IDLE_RECOVERY_DEFAULT_RECHECK_MAX_MINUTES
    ),
    workers: field(settings, 'forkIdleSweepWorkers') === 'include' ? 'include' : 'skip',
    paused: normalizeIdleRecoveryPaused(field(settings, 'forkIdleSweepPaused')),
    notifyDesktop: field(settings, 'forkInboxNotifyDesktop') === true,
    notifyWebhookUrl: webhookUrl(field(settings, 'forkInboxNotifyWebhookUrl')),
    notifyCommand: text(field(settings, 'forkInboxNotifyCommand'), MAX_COMMAND_CHARS)
  }
}

/** True while idle recovery may look at chats at all. */
export function idleRecoveryEnabled(settings: IdleRecoverySettingsSource): boolean {
  return readIdleRecoverySettings(settings).mode !== 'off'
}

/** The settings update that pauses or resumes idle recovery for one chat. */
export function withIdleRecoveryPaused(
  settings: IdleRecoverySettingsSource,
  chatId: string,
  paused: boolean
): Pick<ForkGlobalSettings, 'forkIdleSweepPaused'> {
  const rest = readIdleRecoverySettings(settings).paused.filter((id) => id !== chatId)
  return { forkIdleSweepPaused: normalizeIdleRecoveryPaused(paused ? [...rest, chatId] : rest) }
}
