import { describe, expect, it } from 'vitest'
import { isPinnedToNetworkAddress } from './pinned-bind-host'

describe('isPinnedToNetworkAddress', () => {
  it('treats Tailscale and LAN addresses as already exposed', () => {
    expect(isPinnedToNetworkAddress('100.65.199.126')).toBe(true)
    expect(isPinnedToNetworkAddress('192.168.1.20')).toBe(true)
    expect(isPinnedToNetworkAddress('[fd7a:115c:a1e0::1]')).toBe(true)
  })

  it('does not treat unpinned, loopback or wildcard binds as exposed', () => {
    for (const host of [
      null,
      undefined,
      '',
      '127.0.0.1',
      '127.0.0.2',
      'localhost',
      '::1',
      '[::1]',
      '0.0.0.0',
      '::'
    ]) {
      expect(isPinnedToNetworkAddress(host)).toBe(false)
    }
  })
})
