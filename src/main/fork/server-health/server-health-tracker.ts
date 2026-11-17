// Server health (SLRM-2311, FORK.md): the state of each paired server, fed every few seconds with
// what the desktop's own connection to it says (the endpoint failover supervisor's reading; no
// second prober). It returns the alerts to send: one when a server has been unreachable for the
// offline time, one when it has answered again for the recovery time. Both times are hysteresis,
// so a server that flaps gives at most one pair of alerts per outage. Time the desktop itself was
// asleep (a gap between readings) never counts toward an outage. Pure: no timers, no I/O.
import type {
  ForkServerHealthConfig,
  ForkServerHealthEntry
} from '../../../shared/fork/server-health'

export type ServerConnectionReading = 'ready' | 'down' | 'idle'

export type ServerHealthAlert =
  | {
      kind: 'offline'
      environmentId: string
      name: string
      downSince: number
      lastSeenAt: number | null
      at: number
    }
  | {
      kind: 'recovered'
      environmentId: string
      name: string
      downSince: number
      downtimeMs: number
      at: number
    }

/** Readings further apart than this mean the desktop slept or hung; the gap is not counted. */
export const SERVER_HEALTH_GAP_MS = 60_000

type Tracked = ForkServerHealthEntry & {
  upSince: number | null
  alerted: boolean
  lastReadAt: number
}

export class ServerHealthTracker {
  private readonly servers = new Map<string, Tracked>()

  /** One reading per server; returns the alerts it causes. */
  observe(
    server: { id: string; name: string },
    reading: ServerConnectionReading,
    now: number,
    config: Pick<ForkServerHealthConfig, 'offlineMs' | 'recoveryMs'>
  ): ServerHealthAlert[] {
    const entry = this.entryFor(server, now)
    if (now - entry.lastReadAt > SERVER_HEALTH_GAP_MS) {
      // Asleep or hung here: restart the counts rather than blame the server for our gap.
      if (entry.downSince !== null && !entry.alerted) {
        entry.downSince = now
      }
      if (entry.upSince !== null) {
        entry.upSince = now
      }
    }
    entry.lastReadAt = now
    if (reading === 'idle') {
      // Nothing to judge it by. A drop we alerted on ends without a back alert.
      Object.assign(entry, { state: 'unwatched', downSince: null, upSince: null, alerted: false })
      return []
    }
    if (reading === 'ready') {
      return this.answered(entry, now, config.recoveryMs)
    }
    return this.unanswered(entry, now, config.offlineMs)
  }

  private answered(entry: Tracked, now: number, recoveryMs: number): ServerHealthAlert[] {
    entry.lastSeenAt = now
    if (entry.downSince === null) {
      entry.state = 'up'
      entry.upSince = null
      return []
    }
    entry.upSince ??= now
    if (now - entry.upSince < recoveryMs) {
      entry.state = entry.alerted ? 'recovering' : 'down'
      return []
    }
    const downSince = entry.downSince
    const downtimeMs = Math.max(0, entry.upSince - downSince)
    const wasAlerted = entry.alerted
    Object.assign(entry, { state: 'up', downSince: null, upSince: null, alerted: false })
    if (!wasAlerted) {
      return []
    }
    entry.lastOutage = { downtimeMs, endedAt: now }
    return [
      {
        kind: 'recovered',
        environmentId: entry.environmentId,
        name: entry.name,
        downSince,
        downtimeMs,
        at: now
      }
    ]
  }

  private unanswered(entry: Tracked, now: number, offlineMs: number): ServerHealthAlert[] {
    // A short answer between drops does not end the drop (the recovery time decides that).
    entry.upSince = null
    entry.downSince ??= now
    if (entry.alerted) {
      entry.state = 'offline'
      return []
    }
    if (now - entry.downSince < offlineMs) {
      entry.state = 'down'
      return []
    }
    entry.alerted = true
    entry.state = 'offline'
    return [
      {
        kind: 'offline',
        environmentId: entry.environmentId,
        name: entry.name,
        downSince: entry.downSince,
        lastSeenAt: entry.lastSeenAt,
        at: now
      }
    ]
  }

  private entryFor(server: { id: string; name: string }, now: number): Tracked {
    let entry = this.servers.get(server.id)
    if (!entry) {
      entry = {
        environmentId: server.id,
        name: server.name,
        state: 'unwatched',
        lastSeenAt: null,
        downSince: null,
        lastOutage: null,
        upSince: null,
        alerted: false,
        lastReadAt: now
      }
      this.servers.set(server.id, entry)
    }
    entry.name = server.name
    return entry
  }

  /** Forget servers that are no longer saved. */
  retain(ids: ReadonlySet<string>): void {
    for (const id of this.servers.keys()) {
      if (!ids.has(id)) {
        this.servers.delete(id)
      }
    }
  }

  clear(): void {
    this.servers.clear()
  }

  list(): ForkServerHealthEntry[] {
    return [...this.servers.values()]
      .map(({ environmentId, name, state, lastSeenAt, downSince, lastOutage }) => ({
        environmentId,
        name,
        state,
        lastSeenAt,
        downSince,
        lastOutage
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }
}
