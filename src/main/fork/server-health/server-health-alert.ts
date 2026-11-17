// Server health (SLRM-2311, FORK.md): turns a tracker alert into the notify targets' message. The
// targets are the Decision inbox's (SLRM-2208): desktop notification, webhook POST, command on
// stdin, each with its own on/off setting for server alerts.
import { formatForkDuration, type ForkServerHealthConfig } from '../../../shared/fork/server-health'
import type { ForkNotifyMessage } from '../idle-recovery/idle-recovery-notify'
import type { ServerHealthAlert } from './server-health-tracker'

const MAX_NAME_CHARS = 200

function clip(name: string): string {
  return name.length > MAX_NAME_CHARS ? name.slice(0, MAX_NAME_CHARS) : name
}

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString()
}

/** The JSON a webhook or command gets. `event` tells it apart from the inbox's payload. */
export function serverHealthAlertPayload(alert: ServerHealthAlert): string {
  const server = { id: alert.environmentId, name: clip(alert.name) }
  if (alert.kind === 'offline') {
    return JSON.stringify({
      event: 'server-offline',
      server,
      downSince: iso(alert.downSince),
      lastSeenAt: iso(alert.lastSeenAt),
      at: iso(alert.at)
    })
  }
  return JSON.stringify({
    event: 'server-recovered',
    server,
    downSince: iso(alert.downSince),
    downtimeSeconds: Math.round(alert.downtimeMs / 1000),
    at: iso(alert.at)
  })
}

function desktopText(alert: ServerHealthAlert): { title: string; body: string } {
  const name = clip(alert.name)
  if (alert.kind === 'offline') {
    return {
      title: `${name} is not answering`,
      body: `No answer for ${formatForkDuration(alert.at - alert.downSince)}.`
    }
  }
  return {
    title: `${name} is back`,
    body: `It was down for ${formatForkDuration(alert.downtimeMs)}.`
  }
}

export function serverHealthAlertMessage(
  alert: ServerHealthAlert,
  config: ForkServerHealthConfig
): ForkNotifyMessage {
  return {
    logTag: 'fork-server-health',
    desktop: config.alertDesktop ? desktopText(alert) : null,
    webhookUrl: config.webhookUrl,
    command: config.command,
    payload: () => serverHealthAlertPayload(alert)
  }
}
