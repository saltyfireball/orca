// Endpoint failover (SLRM-2267, FORK.md): the supervisor. Every few seconds it looks at each saved
// server the desktop has a live control connection to. When that connection has been down a
// while, it probes the server's routes best first and moves to the first that answers. While it
// runs on a worse route, it probes the better ones once per retry interval and moves back. A
// move only re-points new sockets and reconnects this desktop's connection: terminals and chats
// live on the server and carry on, and their streams reopen on the new route. Everything it
// touches outside this file comes in through `deps`, so tests drive it with fakes and fake timers.
import type { KnownRuntimeEnvironment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { isListedRemoteServer } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import {
  buildForkEndpointCandidates,
  forkEndpointFailoverEnabled,
  forkEndpointFailoverRetrySeconds,
  filterForkLearnedAddresses,
  forkEndpointLearnAddresses,
  forkEndpointLearnSameSubnetOnly,
  normalizeForkLearnedAddresses,
  type ForkEndpointCandidate,
  type ForkLearnedAddress
} from '../../../shared/fork/endpoint-failover'
import {
  forkActiveEndpointRoute,
  hasForkActiveEndpointRoute,
  setForkActiveEndpointRoute,
  type ForkEndpointRoute
} from '../../../shared/fork/endpoint-failover-active'
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'

/** How often connection states are read; reading is in-memory and cheap. */
export const FAILOVER_WATCH_MS = 5_000
/** How long a connection stays down before other routes are tried. */
export const FAILOVER_AFTER_MS = 10_000
/** Least time between two failover passes for one server while it stays down. */
export const FAILOVER_RETRY_MS = 15_000
/** How often a server is asked for its addresses while connected. */
export const LEARN_EVERY_MS = 10 * 60_000
export const PROBE_TIMEOUT_MS = 4_000
/** A better route that failed again soon after a move back waits up to this many intervals. */
const MAX_BACKOFF_FACTOR = 32

export type FailoverConnectionState = 'idle' | 'ready' | 'down'

export type LearnedRoutes = { addresses: ForkLearnedAddress[]; learnedAt: number }

export type EndpointFailoverDeps = {
  readSettings: () => ForkGlobalSettings | null | undefined
  listEnvironments: () => KnownRuntimeEnvironment[] | Promise<KnownRuntimeEnvironment[]>
  /** 'idle' when the desktop holds no connection to it (or it was disconnected by hand). */
  connectionState: (environmentId: string) => FailoverConnectionState
  /** Whether the server answers on this route, authenticated with its pairing and host key. */
  probe: (
    route: ForkEndpointRoute & { pairedDeviceId?: string },
    timeoutMs: number
  ) => Promise<boolean>
  /** The server's own report of its addresses over the live connection; null if it has none. */
  learn: (environmentId: string) => Promise<unknown>
  /** Drops this desktop's connections to the server and opens them again on the active route. */
  reconnect: (environmentId: string) => void
  readRoutes: (environmentId: string, hostKey: string) => LearnedRoutes | null
  writeRoutes: (environmentId: string, hostKey: string, routes: LearnedRoutes) => void
  now: () => number
  log?: (message: string) => void
}

type ServerState = {
  downSince: number | null
  lastFailoverAt: number
  lastBetterAt: number
  lastLearnAt: number
  /** When the supervisor last moved to a better route, to spot one that does not hold. */
  movedBackAt: number | null
  backoff: number
  busy: boolean
}

function isFailoverEligible(environment: KnownRuntimeEnvironment): boolean {
  // Tunnelled, managed, WSL and recipe VM servers have one route, owned by their own code.
  return (
    isListedRemoteServer(environment) &&
    !environment.connectionDependency &&
    !environment.sshAccess &&
    !environment.pendingSshAccessOperation &&
    !environment.orcadDeployment
  )
}

function savedPreferred(environment: KnownRuntimeEnvironment) {
  return (
    environment.endpoints.find((entry) => entry.id === environment.preferredEndpointId) ??
    environment.endpoints[0]
  )
}

function sameRoute(a: ForkEndpointRoute, b: ForkEndpointRoute): boolean {
  return a.endpoint === b.endpoint && a.deviceToken === b.deviceToken
}

function routeLabel(candidate: ForkEndpointCandidate): string {
  try {
    return `${candidate.kind} ${new URL(candidate.endpoint).host}`
  } catch {
    return candidate.kind
  }
}

export class EndpointFailoverSupervisor {
  private readonly servers = new Map<string, ServerState>()
  /** Servers this supervisor moved off their saved route, to move back when switched off. */
  private readonly moved = new Set<string>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: EndpointFailoverDeps) {}

  start(): void {
    if (this.timer) {
      return
    }
    this.timer = setInterval(() => void this.tick(), FAILOVER_WATCH_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** One pass over every saved server; exported for tests, which await it. */
  async tick(): Promise<void> {
    const settings = this.deps.readSettings()
    const environments = await this.deps.listEnvironments()
    if (!forkEndpointFailoverEnabled(settings)) {
      this.releaseAll(environments)
      return
    }
    const retryMs = forkEndpointFailoverRetrySeconds(settings) * 1000
    const learn = forkEndpointLearnAddresses(settings)
    const sameSubnetOnly = forkEndpointLearnSameSubnetOnly(settings)
    const live = new Set<string>()
    await Promise.all(
      environments.map(async (environment) => {
        live.add(environment.id)
        if (!isFailoverEligible(environment)) {
          return
        }
        const state = this.stateFor(environment.id)
        if (state.busy) {
          return
        }
        state.busy = true
        try {
          await this.checkServer(environment, state, retryMs, learn, sameSubnetOnly)
        } catch (error) {
          this.deps.log?.(
            `[fork-endpoint-failover] ${environment.name}: check failed: ${String(error)}`
          )
        } finally {
          state.busy = false
        }
      })
    )
    for (const id of this.servers.keys()) {
      if (!live.has(id)) {
        this.servers.delete(id)
        this.moved.delete(id)
      }
    }
  }

  private stateFor(environmentId: string): ServerState {
    let state = this.servers.get(environmentId)
    if (!state) {
      state = {
        downSince: null,
        lastFailoverAt: Number.NEGATIVE_INFINITY,
        lastBetterAt: Number.NEGATIVE_INFINITY,
        lastLearnAt: Number.NEGATIVE_INFINITY,
        movedBackAt: null,
        backoff: 1,
        busy: false
      }
      this.servers.set(environmentId, state)
    }
    return state
  }

  private async checkServer(
    environment: KnownRuntimeEnvironment,
    state: ServerState,
    retryMs: number,
    learn: boolean,
    sameSubnetOnly: boolean
  ): Promise<void> {
    const preferred = savedPreferred(environment)
    if (!preferred) {
      return
    }
    const connection = this.deps.connectionState(environment.id)
    if (connection === 'idle') {
      state.downSince = null
      return
    }
    const now = this.deps.now()
    if (connection === 'ready' && learn && now - state.lastLearnAt >= LEARN_EVERY_MS) {
      state.lastLearnAt = now
      await this.learnRoutes(environment.id, preferred.publicKeyB64)
    }
    const stored = learn ? this.deps.readRoutes(environment.id, preferred.publicKeyB64) : null
    const candidates = buildForkEndpointCandidates(
      preferred,
      environment.endpoints.filter((entry) => entry.id !== preferred.id),
      filterForkLearnedAddresses(
        stored?.addresses ?? [],
        environment.endpoints.map((entry) => entry.endpoint),
        sameSubnetOnly
      )
    )
    const active = forkActiveEndpointRoute(preferred)
    const activeIndex = candidates.findIndex((candidate) => sameRoute(candidate, active))
    if (connection === 'ready') {
      state.downSince = null
      if (activeIndex === 0) {
        // On the best route and holding: a later failure starts from a clean slate.
        if (state.movedBackAt !== null && now - state.movedBackAt >= 2 * retryMs) {
          state.backoff = 1
          state.movedBackAt = null
        }
        return
      }
      if (now - state.lastBetterAt < retryMs * state.backoff) {
        return
      }
      state.lastBetterAt = now
      const better = activeIndex === -1 ? candidates : candidates.slice(0, activeIndex)
      const found = await this.firstAnswering(environment, better)
      if (found) {
        state.movedBackAt = now
        this.moveTo(environment, preferred, found, 'better route')
      }
      return
    }
    // Down: give the connection's own retry a moment before trying other routes.
    state.downSince ??= now
    if (
      now - state.downSince < FAILOVER_AFTER_MS ||
      now - state.lastFailoverAt < FAILOVER_RETRY_MS
    ) {
      return
    }
    state.lastFailoverAt = now
    if (candidates.length < 2 && activeIndex === 0) {
      return
    }
    const found = await this.firstAnswering(environment, candidates)
    if (!found || sameRoute(found, active)) {
      return
    }
    if (state.movedBackAt !== null && now - state.movedBackAt < 2 * retryMs) {
      // The better route answered a probe but did not hold: wait longer before the next try.
      state.backoff = Math.min(state.backoff * 2, MAX_BACKOFF_FACTOR)
      state.movedBackAt = null
    }
    state.downSince = null
    state.lastBetterAt = now
    this.moveTo(environment, preferred, found, 'failover')
  }

  private async firstAnswering(
    environment: KnownRuntimeEnvironment,
    candidates: readonly ForkEndpointCandidate[]
  ): Promise<ForkEndpointCandidate | null> {
    // In order, one at a time: the first answer wins, and a later route is never dialed early.
    for (const candidate of candidates) {
      let answered = false
      try {
        answered = await this.deps.probe(
          {
            endpoint: candidate.endpoint,
            deviceToken: candidate.deviceToken,
            publicKeyB64: candidate.publicKeyB64,
            ...(environment.pairedDeviceId ? { pairedDeviceId: environment.pairedDeviceId } : {})
          },
          PROBE_TIMEOUT_MS
        )
      } catch {
        answered = false
      }
      if (answered) {
        return candidate
      }
    }
    return null
  }

  private moveTo(
    environment: KnownRuntimeEnvironment,
    preferred: NonNullable<ReturnType<typeof savedPreferred>>,
    candidate: ForkEndpointCandidate,
    why: string
  ): void {
    setForkActiveEndpointRoute(preferred, candidate)
    if (hasForkActiveEndpointRoute(preferred)) {
      this.moved.add(environment.id)
    } else {
      this.moved.delete(environment.id)
    }
    this.deps.log?.(
      `[fork-endpoint-failover] ${environment.name}: ${why}, now on ${routeLabel(candidate)}`
    )
    this.deps.reconnect(environment.id)
  }

  private async learnRoutes(environmentId: string, hostKey: string): Promise<void> {
    let reply: unknown = null
    try {
      reply = await this.deps.learn(environmentId)
    } catch {
      reply = null
    }
    // A server without the method (stock Orca) keeps whatever was learned before.
    if (reply === null || reply === undefined) {
      return
    }
    this.deps.writeRoutes(environmentId, hostKey, {
      addresses: normalizeForkLearnedAddresses(reply),
      learnedAt: this.deps.now()
    })
  }

  /** The switch went off: every moved server goes back to its saved route. */
  private releaseAll(environments: readonly KnownRuntimeEnvironment[]): void {
    for (const environment of environments) {
      if (!this.moved.has(environment.id)) {
        continue
      }
      const preferred = savedPreferred(environment)
      if (preferred) {
        setForkActiveEndpointRoute(preferred, null)
        this.deps.reconnect(environment.id)
      }
    }
    this.moved.clear()
    this.servers.clear()
  }
}
