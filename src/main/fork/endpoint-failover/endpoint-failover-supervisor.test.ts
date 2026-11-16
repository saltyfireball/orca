import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnownRuntimeEnvironment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { getPreferredPairedRuntimeConnection } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { clearForkActiveEndpointRoutes } from '../../../shared/fork/endpoint-failover-active'
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'
import {
  EndpointFailoverSupervisor,
  FAILOVER_AFTER_MS,
  FAILOVER_WATCH_MS,
  type EndpointFailoverDeps,
  type FailoverConnectionState,
  type LearnedRoutes
} from './endpoint-failover-supervisor'

const SAVED = 'ws://203.0.113.10:6768/'
const LAN = 'ws://192.168.1.20:6768/'
const TAILNET = 'ws://100.90.1.2:6768/'

function environment(overrides: Partial<KnownRuntimeEnvironment> = {}): KnownRuntimeEnvironment {
  return {
    id: 'env-1',
    name: 'stub server',
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: null,
    runtimeId: null,
    endpoints: [
      {
        id: 'ws-env-1',
        kind: 'websocket',
        label: 'WebSocket',
        endpoint: SAVED,
        deviceToken: 'stub-token',
        publicKeyB64: 'stub-host-key'
      }
    ],
    preferredEndpointId: 'ws-env-1',
    ...overrides
  }
}

/** Fake world: which endpoints answer, the connection state, and what was dialed. */
function harness(options: { env?: KnownRuntimeEnvironment; settings?: ForkGlobalSettings } = {}) {
  const env = options.env ?? environment()
  const answering = new Set<string>()
  let state: FailoverConnectionState = 'ready'
  let settings: ForkGlobalSettings = options.settings ?? {}
  const probes: string[] = []
  const reconnects: string[] = []
  const stored = new Map<string, LearnedRoutes>()
  let learnReply: unknown = null
  const deps: EndpointFailoverDeps = {
    readSettings: () => settings,
    listEnvironments: () => [env],
    connectionState: () => state,
    probe: async (route) => {
      probes.push(route.endpoint)
      return answering.has(route.endpoint)
    },
    learn: async () => learnReply,
    reconnect: (id) => {
      reconnects.push(id)
    },
    readRoutes: (id, hostKey) => stored.get(`${id}:${hostKey}`) ?? null,
    writeRoutes: (id, hostKey, routes) => {
      stored.set(`${id}:${hostKey}`, routes)
    },
    now: () => Date.now()
  }
  const supervisor = new EndpointFailoverSupervisor(deps)
  return {
    env,
    supervisor,
    answering,
    probes,
    reconnects,
    stored,
    dialed: () => getPreferredPairedRuntimeConnection(env).endpoint,
    setState: (next: FailoverConnectionState) => {
      state = next
    },
    setSettings: (next: ForkGlobalSettings) => {
      settings = next
    },
    setLearnReply: (reply: unknown) => {
      learnReply = reply
    },
    /** Moves the clock and runs the supervisor's own interval ticks in between. */
    advance: async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms)
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-15T12:00:00Z'))
})

afterEach(() => {
  clearForkActiveEndpointRoutes()
  vi.useRealTimers()
})

describe('EndpointFailoverSupervisor', () => {
  it('learns the server addresses while connected and moves to the better LAN route', async () => {
    const h = harness()
    h.setLearnReply({ addresses: [{ address: '192.168.1.20' }, { address: '100.90.1.2' }] })
    h.answering.add(LAN)
    h.answering.add(SAVED)
    h.supervisor.start()
    await h.advance(FAILOVER_WATCH_MS)
    expect(h.stored.get('env-1:stub-host-key')?.addresses).toEqual([
      { address: '192.168.1.20', kind: 'lan' },
      { address: '100.90.1.2', kind: 'tailscale' }
    ])
    // Ready on the saved (worst) route: the better ones are tried in order, the first wins.
    expect(h.probes).toEqual([LAN])
    expect(h.dialed()).toBe(LAN)
    expect(h.reconnects).toEqual(['env-1'])
    h.supervisor.stop()
  })

  it('fails over in order only after the connection stays down, then retries the better route', async () => {
    const h = harness()
    h.stored.set('env-1:stub-host-key', {
      addresses: [
        { address: '192.168.1.20', kind: 'lan' },
        { address: '100.90.1.2', kind: 'tailscale' }
      ],
      learnedAt: 0
    })
    // Start on the LAN route, which then drops; only Tailscale answers.
    h.answering.add(LAN)
    h.supervisor.start()
    await h.advance(FAILOVER_WATCH_MS)
    expect(h.dialed()).toBe(LAN)
    // It holds for a while, so its later failure is not held against it.
    await h.advance(180_000)
    h.answering.clear()
    h.answering.add(TAILNET)
    h.setState('down')
    h.probes.length = 0
    await h.advance(FAILOVER_AFTER_MS - FAILOVER_WATCH_MS)
    expect(h.probes).toEqual([])
    await h.advance(FAILOVER_AFTER_MS)
    expect(h.probes).toEqual([LAN, TAILNET])
    expect(h.dialed()).toBe(TAILNET)
    h.setState('ready')
    // The LAN route is tried again once per retry interval (60 s by default), not before.
    h.probes.length = 0
    await h.advance(55_000)
    expect(h.probes).toEqual([])
    await h.advance(10_000)
    expect(h.probes).toEqual([LAN])
    expect(h.dialed()).toBe(TAILNET)
    // LAN answers again: move back.
    h.answering.add(LAN)
    await h.advance(60_000)
    expect(h.dialed()).toBe(LAN)
    expect(h.reconnects).toHaveLength(3)
    h.supervisor.stop()
  })

  it('stays put when the active route itself answers the failover probe', async () => {
    const h = harness()
    h.stored.set('env-1:stub-host-key', {
      addresses: [{ address: '100.90.1.2', kind: 'tailscale' }],
      learnedAt: 0
    })
    h.setLearnReply(null)
    h.answering.add(TAILNET)
    h.supervisor.start()
    await h.advance(FAILOVER_WATCH_MS)
    expect(h.dialed()).toBe(TAILNET)
    h.setState('down')
    await h.advance(FAILOVER_AFTER_MS + FAILOVER_WATCH_MS)
    expect(h.dialed()).toBe(TAILNET)
    expect(h.reconnects).toHaveLength(1)
    h.supervisor.stop()
  })

  it('does nothing for a server with one route, an idle connection, or a tunnelled server', async () => {
    const one = harness()
    one.setState('down')
    await one.supervisor.tick()
    await one.advance(FAILOVER_AFTER_MS)
    await one.supervisor.tick()
    expect(one.reconnects).toEqual([])

    const idle = harness()
    idle.stored.set('env-1:stub-host-key', {
      addresses: [{ address: '192.168.1.20', kind: 'lan' }],
      learnedAt: 0
    })
    idle.answering.add(LAN)
    idle.setState('idle')
    await idle.supervisor.tick()
    expect(idle.probes).toEqual([])

    const tunnelled = harness({ env: environment({ connectionDependency: 'ssh-tunnel' }) })
    tunnelled.stored.set('env-1:stub-host-key', {
      addresses: [{ address: '192.168.1.20', kind: 'lan' }],
      learnedAt: 0
    })
    tunnelled.answering.add(LAN)
    await tunnelled.supervisor.tick()
    expect(tunnelled.probes).toEqual([])
  })

  it('switched off: probes nothing and moves a moved server back to its saved route', async () => {
    const h = harness()
    h.stored.set('env-1:stub-host-key', {
      addresses: [{ address: '192.168.1.20', kind: 'lan' }],
      learnedAt: 0
    })
    h.answering.add(LAN)
    await h.supervisor.tick()
    expect(h.dialed()).toBe(LAN)
    h.setSettings({ forkEndpointFailover: false })
    h.probes.length = 0
    await h.supervisor.tick()
    expect(h.dialed()).toBe(SAVED)
    expect(h.reconnects).toEqual(['env-1', 'env-1'])
    await h.supervisor.tick()
    expect(h.probes).toEqual([])
  })

  it('with learning off, neither asks the server nor uses learned routes', async () => {
    const h = harness({ settings: { forkEndpointLearnAddresses: false } })
    h.setLearnReply({ addresses: ['192.168.1.20'] })
    h.stored.set('env-1:stub-host-key', {
      addresses: [{ address: '192.168.1.20', kind: 'lan' }],
      learnedAt: 0
    })
    h.answering.add(LAN)
    await h.supervisor.tick()
    expect(h.probes).toEqual([])
    expect(h.dialed()).toBe(SAVED)
  })

  it('backs off a better route that answers probes but does not hold', async () => {
    const h = harness()
    h.stored.set('env-1:stub-host-key', {
      addresses: [{ address: '192.168.1.20', kind: 'lan' }],
      learnedAt: 0
    })
    h.answering.add(SAVED)
    h.supervisor.start()
    // The LAN route answers a probe, the supervisor moves, then the connection on it fails.
    h.answering.add(LAN)
    await h.advance(FAILOVER_WATCH_MS)
    expect(h.dialed()).toBe(LAN)
    h.answering.delete(LAN)
    h.setState('down')
    await h.advance(FAILOVER_AFTER_MS + FAILOVER_WATCH_MS)
    expect(h.dialed()).toBe(SAVED)
    h.setState('ready')
    h.answering.add(LAN)
    h.probes.length = 0
    // Doubled: no try at 60 s, one by 120 s.
    await h.advance(65_000)
    expect(h.probes).toEqual([])
    await h.advance(60_000)
    expect(h.probes).toEqual([LAN])
    h.supervisor.stop()
  })
})
