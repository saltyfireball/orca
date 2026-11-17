// Server heartbeat (SLRM-2311, FORK.md): when `forkServerHeartbeatUrl` holds an http(s) address,
// this host calls it every `forkServerHeartbeatSeconds` (GET, or POST with an empty body), so an
// outside monitor (healthchecks, n8n, Home Assistant) notices when the host stops, even while no
// desktop is awake to watch it. Off by default. The settings are read before every call, so a
// change takes effect at the next one, with no restart. The address usually carries the
// monitor's token: it is never logged, and only a change between working and failing is logged.
// Nothing about the host is sent. Keep electron out of this file (the headless server runs it).
import {
  readForkServerHeartbeatConfig,
  type ForkServerHealthSettingsSource,
  type ForkServerHeartbeatStatus
} from '../../../shared/fork/server-health'

export const HEARTBEAT_TIMEOUT_MS = 10_000
/** How often the settings are looked at again while the heartbeat is off or its address is bad. */
export const HEARTBEAT_IDLE_RECHECK_MS = 30_000

export type ServerHeartbeatDeps = {
  readSettings: () => ForkServerHealthSettingsSource
  fetchImpl?: typeof fetch
  now?: () => number
  log?: (message: string) => void
}

export class ServerHeartbeat {
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private status: ForkServerHeartbeatStatus = { state: 'off', lastOkAt: null }

  constructor(private readonly deps: ServerHeartbeatDeps) {}

  start(): void {
    if (this.running) {
      return
    }
    this.running = true
    this.schedule(0)
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  read(): ForkServerHeartbeatStatus {
    return { ...this.status }
  }

  private schedule(delayMs: number): void {
    if (!this.running) {
      return
    }
    this.timer = setTimeout(() => void this.beat(), delayMs)
    this.timer.unref?.()
  }

  /** One call (or none, when off); exported for tests. Never throws. */
  async beat(): Promise<void> {
    let config: ReturnType<typeof readForkServerHeartbeatConfig>
    try {
      config = readForkServerHeartbeatConfig(this.deps.readSettings())
    } catch {
      config = { state: 'off' }
    }
    if (config.state !== 'on') {
      this.status = { state: config.state, lastOkAt: this.status.lastOkAt }
      this.schedule(HEARTBEAT_IDLE_RECHECK_MS)
      return
    }
    const ok = await this.call(config.url, config.method)
    const now = (this.deps.now ?? Date.now)()
    const before = this.status.state
    this.status = { state: ok ? 'ok' : 'failing', lastOkAt: ok ? now : this.status.lastOkAt }
    if (!ok && before !== 'failing') {
      this.deps.log?.('[fork-server-heartbeat] the heartbeat address did not answer with success')
    } else if (ok && before === 'failing') {
      this.deps.log?.('[fork-server-heartbeat] the heartbeat address answers again')
    }
    this.schedule(config.intervalMs)
  }

  private async call(url: string, method: 'GET' | 'POST'): Promise<boolean> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS)
    try {
      const response = await (this.deps.fetchImpl ?? fetch)(url, {
        method,
        ...(method === 'POST' ? { body: '' } : {}),
        // A redirect could carry the call to another host; a monitor address does not redirect.
        redirect: 'error',
        signal: controller.signal
      })
      // Drain so the connection frees; the body is never read for content.
      await response.arrayBuffer().catch(() => undefined)
      return response.ok
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }
}
