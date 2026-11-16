import { afterEach, describe, expect, it } from 'vitest'
import {
  buildForkEndpointCandidates,
  forkEndpointFailoverEnabled,
  forkEndpointFailoverRetrySeconds,
  forkEndpointLearnAddresses,
  learnedRouteUrl,
  normalizeForkLearnedAddresses
} from './endpoint-failover'
import {
  clearForkActiveEndpointRoutes,
  forkActiveEndpointRoute,
  hasForkActiveEndpointRoute,
  setForkActiveEndpointRoute
} from './endpoint-failover-active'
import { getPreferredPairedRuntimeConnection } from '../remote-runtime/host-catalog/runtime-environments'

const saved = {
  id: 'ws-env-1',
  endpoint: 'ws://100.90.1.2:6768/',
  deviceToken: 'stub-token',
  publicKeyB64: 'stub-host-key'
}

afterEach(() => clearForkActiveEndpointRoutes())

describe('endpoint failover settings', () => {
  it('is on by default and off only when set false', () => {
    expect(forkEndpointFailoverEnabled(undefined)).toBe(true)
    expect(forkEndpointFailoverEnabled({})).toBe(true)
    expect(forkEndpointFailoverEnabled({ forkEndpointFailover: false })).toBe(false)
    expect(forkEndpointLearnAddresses({})).toBe(true)
    expect(forkEndpointLearnAddresses({ forkEndpointLearnAddresses: false })).toBe(false)
  })

  it('reads the retry interval within bounds, else 60', () => {
    expect(forkEndpointFailoverRetrySeconds({})).toBe(60)
    expect(forkEndpointFailoverRetrySeconds({ forkEndpointFailoverRetrySeconds: 120 })).toBe(120)
    expect(forkEndpointFailoverRetrySeconds({ forkEndpointFailoverRetrySeconds: 5 })).toBe(60)
    expect(forkEndpointFailoverRetrySeconds({ forkEndpointFailoverRetrySeconds: 1.5 })).toBe(60)
    expect(forkEndpointFailoverRetrySeconds({ forkEndpointFailoverRetrySeconds: 99999 })).toBe(60)
  })
})

describe('normalizeForkLearnedAddresses', () => {
  it('keeps IPv4 LAN and Tailscale addresses, deduplicated', () => {
    expect(
      normalizeForkLearnedAddresses({
        addresses: [
          { address: '192.168.1.20' },
          '100.101.102.103',
          '192.168.1.20',
          '8.8.8.8',
          '127.0.0.1',
          'fd00::1',
          'not an ip',
          42
        ]
      })
    ).toEqual([
      { address: '192.168.1.20', kind: 'lan' },
      { address: '100.101.102.103', kind: 'tailscale' }
    ])
  })

  it('caps the list and reads junk as empty', () => {
    const many = Array.from({ length: 20 }, (_, i) => `10.0.0.${i + 1}`)
    expect(normalizeForkLearnedAddresses(many)).toHaveLength(8)
    expect(normalizeForkLearnedAddresses(null)).toEqual([])
    expect(normalizeForkLearnedAddresses({ addresses: 'x' })).toEqual([])
  })
})

describe('buildForkEndpointCandidates', () => {
  it('orders LAN, then Tailscale, then other addresses, saved before learned', () => {
    const candidates = buildForkEndpointCandidates(
      { ...saved, endpoint: 'ws://server.example.test:6768/' },
      [],
      [
        { address: '100.90.1.2', kind: 'tailscale' },
        { address: '192.168.1.20', kind: 'lan' }
      ]
    )
    expect(candidates.map((c) => [c.endpoint, c.kind, c.learned])).toEqual([
      ['ws://192.168.1.20:6768/', 'lan', true],
      ['ws://100.90.1.2:6768/', 'tailscale', true],
      ['ws://server.example.test:6768/', 'public', false]
    ])
    expect(candidates.every((c) => c.deviceToken === 'stub-token')).toBe(true)
  })

  it('folds a learned address that equals the saved one into the saved route', () => {
    const candidates = buildForkEndpointCandidates(
      saved,
      [],
      [{ address: '100.90.1.2', kind: 'tailscale' }]
    )
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.learned).toBe(false)
  })

  it('skips other saved endpoints of another host key and never learns for loopback or wss', () => {
    const other = { ...saved, id: 'b', endpoint: 'ws://10.0.0.5:6768/', publicKeyB64: 'other' }
    expect(buildForkEndpointCandidates(saved, [other], [])).toHaveLength(1)
    const loop = { ...saved, endpoint: 'ws://127.0.0.1:7000/' }
    expect(
      buildForkEndpointCandidates(loop, [], [{ address: '10.0.0.5', kind: 'lan' }])
    ).toHaveLength(1)
    expect(learnedRouteUrl('wss://host.example.test/', '10.0.0.5')).toBeNull()
    expect(learnedRouteUrl('ws://host.example.test:1234/rpc', '10.0.0.5')).toBe(
      'ws://10.0.0.5:1234/rpc'
    )
  })
})

describe('active endpoint route', () => {
  const environment = {
    name: 'stub',
    endpoints: [{ ...saved, kind: 'websocket' as const, label: 'WebSocket' }],
    preferredEndpointId: saved.id
  }

  it('dials the saved endpoint until a route is picked', () => {
    expect(getPreferredPairedRuntimeConnection(environment).endpoint).toBe(saved.endpoint)
    setForkActiveEndpointRoute(saved, { ...saved, endpoint: 'ws://192.168.1.20:6768/' })
    expect(hasForkActiveEndpointRoute(saved)).toBe(true)
    expect(getPreferredPairedRuntimeConnection(environment).endpoint).toBe(
      'ws://192.168.1.20:6768/'
    )
    setForkActiveEndpointRoute(saved, saved)
    expect(hasForkActiveEndpointRoute(saved)).toBe(false)
    expect(getPreferredPairedRuntimeConnection(environment).endpoint).toBe(saved.endpoint)
  })

  it('ignores a picked route after a re-pair or for another host key', () => {
    setForkActiveEndpointRoute(saved, { ...saved, endpoint: 'ws://192.168.1.20:6768/' })
    expect(forkActiveEndpointRoute({ ...saved, deviceToken: 'new-token' }).endpoint).toBe(
      saved.endpoint
    )
    setForkActiveEndpointRoute(saved, {
      ...saved,
      endpoint: 'ws://192.168.1.20:6768/',
      publicKeyB64: 'someone-else'
    })
    expect(forkActiveEndpointRoute(saved).endpoint).toBe(saved.endpoint)
  })
})
