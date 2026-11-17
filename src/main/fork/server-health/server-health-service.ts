// Server health (SLRM-2311, FORK.md): the one tracker and heartbeat of this process.
// - The desktop's endpoint failover install hands every reading of its saved servers' connections
//   to `observeForkServerHealth`, so health has no prober of its own.
// - `fork.serverHealth.list` (and `orca servers health`) reads `listForkServerHealth`.
// - The heartbeat runs wherever the runtime serves: the desktop app and the headless server.
// Keep electron out of this file (the headless server bundles it).
import type { KnownRuntimeEnvironment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { isListedRemoteServer } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import {
  readForkServerHealthConfig,
  type ForkServerHealthListResult,
  type ForkServerHealthSettingsSource
} from '../../../shared/fork/server-health'
import {
  sendForkNotifyTargets,
  type IdleRecoveryNotifyOptions
} from '../idle-recovery/idle-recovery-notify'
import { serverHealthAlertMessage } from './server-health-alert'
import { ServerHealthTracker, type ServerConnectionReading } from './server-health-tracker'
import { ServerHeartbeat } from './server-heartbeat'

type SettingsReader = () => ForkServerHealthSettingsSource

const tracker = new ServerHealthTracker()
let heartbeat: ServerHeartbeat | null = null
let settingsReader: SettingsReader = () => null
let notifyOptions: IdleRecoveryNotifyOptions = {}

/** Tests only: route alerts through fakes. */
export function setForkServerHealthNotifyOptionsForTests(options: IdleRecoveryNotifyOptions): void {
  notifyOptions = options
}

/** Tests only. */
export function resetForkServerHealthForTests(): void {
  tracker.clear()
  heartbeat?.stop()
  heartbeat = null
  settingsReader = () => null
  notifyOptions = {}
}

/** One reading of every saved server. Never throws into the failover tick. */
export function observeForkServerHealth(
  environments: readonly KnownRuntimeEnvironment[],
  connectionState: (environmentId: string) => ServerConnectionReading,
  settings: ForkServerHealthSettingsSource,
  now: number
): void {
  try {
    const config = readForkServerHealthConfig(settings)
    if (!config.enabled) {
      tracker.clear()
      return
    }
    const listed = environments.filter((environment) => isListedRemoteServer(environment))
    tracker.retain(new Set(listed.map((environment) => environment.id)))
    for (const environment of listed) {
      const alerts = tracker.observe(
        { id: environment.id, name: environment.name },
        connectionState(environment.id),
        now,
        config
      )
      for (const alert of alerts) {
        console.warn(
          `[fork-server-health] ${JSON.stringify(environment.name.slice(0, 200))}: ${alert.kind === 'offline' ? 'not answering' : 'back'}`
        )
        void sendForkNotifyTargets(serverHealthAlertMessage(alert, config), notifyOptions)
      }
    }
  } catch (error) {
    console.warn(`[fork-server-health] reading failed: ${String(error)}`)
  }
}

export function startForkServerHeartbeat(readSettings: SettingsReader): void {
  settingsReader = readSettings
  if (heartbeat) {
    return
  }
  heartbeat = new ServerHeartbeat({ readSettings, log: (message) => console.warn(message) })
  heartbeat.start()
}

export function stopForkServerHeartbeat(): void {
  heartbeat?.stop()
  heartbeat = null
}

export function listForkServerHealth(): ForkServerHealthListResult {
  const config = readForkServerHealthConfig(settingsReader())
  return {
    enabled: config.enabled,
    offlineMinutes: Math.round(config.offlineMs / 60_000),
    servers: config.enabled ? tracker.list() : [],
    heartbeat: heartbeat ? heartbeat.read() : { state: 'off', lastOkAt: null }
  }
}
