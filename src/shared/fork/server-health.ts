// Server health (SLRM-2311, FORK.md): a desktop watches the remote servers it is paired with and
// says once when one has stopped answering for a while, and once when it is back, with how long it
// was down. A server can also ping a heartbeat address of the user's choosing, so an outside
// monitor notices when nobody's desktop is awake. Shared by main, the CLI and the Settings card.
import { z } from 'zod'

export type ForkServerHealthSettings = {
  /** Fork (SLRM-2311): watch the paired remote servers this desktop is connected to and alert when one stops answering; unset is on. */
  forkServerHealth?: boolean
  /** Fork server health: minutes a server must stay unreachable before the offline alert; unset is 5. */
  forkServerHealthOfflineMinutes?: number
  /** Fork server health: seconds a server must answer again before it counts as back (no alerts while it flaps); unset is 60. */
  forkServerHealthRecoverySeconds?: number
  /** Fork server health: desktop notification on offline and back; unset follows forkInboxNotifyDesktop. */
  forkServerHealthAlertDesktop?: boolean
  /** Fork server health: POST the alert as JSON to the notification webhook (forkInboxNotifyWebhookUrl); unset is on when that address is set. */
  forkServerHealthAlertWebhook?: boolean
  /** Fork server health: give the alert as JSON on stdin to the notification command (forkInboxNotifyCommand); unset is on when that command is set. Set it in the Settings screen. */
  forkServerHealthAlertCommand?: boolean
  /** Fork server heartbeat (SLRM-2311): an http(s) address this host calls every few seconds so an outside monitor sees it is alive; unset is none. */
  forkServerHeartbeatUrl?: string
  /** Fork server heartbeat: seconds between two calls of the heartbeat address; unset is 60. */
  forkServerHeartbeatSeconds?: number
  /** Fork server heartbeat: 'GET' or 'POST' (with an empty body); unset is 'GET'. */
  forkServerHeartbeatMethod?: 'GET' | 'POST'
}

export const FORK_SERVER_HEALTH_DEFAULT_OFFLINE_MINUTES = 5
export const FORK_SERVER_HEALTH_DEFAULT_RECOVERY_SECONDS = 60
export const FORK_SERVER_HEARTBEAT_DEFAULT_SECONDS = 60
export const FORK_SERVER_HEALTH_OFFLINE_MINUTE_CHOICES: readonly number[] = [
  1, 2, 5, 10, 15, 30, 60
]
export const FORK_SERVER_HEARTBEAT_SECOND_CHOICES: readonly number[] = [30, 60, 120, 300, 600]
const MAX_URL_CHARS = 2000

type SourceKey =
  | keyof ForkServerHealthSettings
  | 'forkInboxNotifyDesktop'
  | 'forkInboxNotifyWebhookUrl'
  | 'forkInboxNotifyCommand'

/** Any settings object; every value is checked here, so a hand-edited file cannot break a reader. */
export type ForkServerHealthSettingsSource = Partial<Record<SourceKey, unknown>> | null | undefined
type Source = ForkServerHealthSettingsSource

function wholeNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback
}

/** An http or https address with a host, no spaces, no user or password in it; else null. */
export function forkHttpUrlOrNull(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || text.length > MAX_URL_CHARS || /\s/.test(text)) {
    return null
  }
  try {
    const url = new URL(text)
    const httpLike = url.protocol === 'http:' || url.protocol === 'https:'
    return httpLike && url.hostname && !url.username && !url.password ? text : null
  } catch {
    return null
  }
}

export type ForkServerHealthConfig = {
  enabled: boolean
  offlineMs: number
  recoveryMs: number
  alertDesktop: boolean
  /** The inbox notification address, when alerts go there. */
  webhookUrl: string | null
  /** The inbox notification command, when alerts go there. */
  command: string | null
}

/** The health watch and its alert targets; the address and command are the Decision inbox's. */
export function readForkServerHealthConfig(settings: Source): ForkServerHealthConfig {
  const url = forkHttpUrlOrNull(settings?.forkInboxNotifyWebhookUrl)
  const rawCommand = settings?.forkInboxNotifyCommand
  const command = typeof rawCommand === 'string' && rawCommand.trim() ? rawCommand.trim() : null
  const desktop = settings?.forkServerHealthAlertDesktop ?? settings?.forkInboxNotifyDesktop
  return {
    enabled: settings?.forkServerHealth !== false,
    offlineMs:
      wholeNumber(
        settings?.forkServerHealthOfflineMinutes,
        1,
        24 * 60,
        FORK_SERVER_HEALTH_DEFAULT_OFFLINE_MINUTES
      ) * 60_000,
    recoveryMs:
      wholeNumber(
        settings?.forkServerHealthRecoverySeconds,
        0,
        3600,
        FORK_SERVER_HEALTH_DEFAULT_RECOVERY_SECONDS
      ) * 1000,
    alertDesktop: desktop === true,
    webhookUrl: settings?.forkServerHealthAlertWebhook === false ? null : url,
    command: settings?.forkServerHealthAlertCommand === false ? null : command
  }
}

export type ForkServerHeartbeatConfig =
  | { state: 'off' }
  | { state: 'invalid' }
  | { state: 'on'; url: string; intervalMs: number; method: 'GET' | 'POST' }

export function readForkServerHeartbeatConfig(settings: Source): ForkServerHeartbeatConfig {
  const raw = settings?.forkServerHeartbeatUrl
  if (typeof raw !== 'string' || !raw.trim()) {
    return { state: 'off' }
  }
  const url = forkHttpUrlOrNull(raw)
  if (!url) {
    return { state: 'invalid' }
  }
  return {
    state: 'on',
    url,
    intervalMs:
      wholeNumber(
        settings?.forkServerHeartbeatSeconds,
        10,
        3600,
        FORK_SERVER_HEARTBEAT_DEFAULT_SECONDS
      ) * 1000,
    method: settings?.forkServerHeartbeatMethod === 'POST' ? 'POST' : 'GET'
  }
}

/**
 * up: answering. down: not answering, not yet long enough to alert. offline: the offline alert
 * went out. recovering: answering again after a drop, not yet long enough to count as back.
 * unwatched: this desktop holds no connection to it (disconnected, or not opened yet).
 */
export type ForkServerHealthState = 'up' | 'down' | 'offline' | 'recovering' | 'unwatched'

export type ForkServerHealthEntry = {
  environmentId: string
  name: string
  state: ForkServerHealthState
  /** Last time it answered, since this app started; null when not seen yet. */
  lastSeenAt: number | null
  /** When the current drop began; null while up. */
  downSince: number | null
  /** The last finished outage this app saw: how long, and when it ended. */
  lastOutage: { downtimeMs: number; endedAt: number } | null
}

export type ForkServerHeartbeatStatus = {
  state: 'off' | 'invalid' | 'ok' | 'failing'
  lastOkAt: number | null
}

export type ForkServerHealthListResult = {
  enabled: boolean
  offlineMinutes: number
  servers: ForkServerHealthEntry[]
  /** This host's own heartbeat to the outside address (never the address itself). */
  heartbeat: ForkServerHeartbeatStatus
}

export const FORK_SERVER_HEALTH_LIST_METHOD = 'fork.serverHealth.list'
export const ForkServerHealthListParams = z.object({})

/** "4 h 15 min", "12 min", "40 s". */
export function formatForkDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) {
    return `${seconds} s`
  }
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) {
    return `${minutes} min`
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`
}
