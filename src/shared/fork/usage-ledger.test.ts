import { describe, expect, it } from 'vitest'
import {
  forkCacheColdConfig,
  forkCacheColdInMs,
  forkCacheColdVerdict,
  forkUsageRetentionDays,
  formatForkTokens,
  type ForkCacheState
} from './usage-ledger'

const MINUTE = 60_000
const T0 = 1_000_000_000

function state(overrides: Partial<ForkCacheState> = {}): ForkCacheState {
  return { sessionId: 's', lastAt: T0, contextTokens: 120_000, working: false, ...overrides }
}

describe('forkCacheColdConfig', () => {
  it('defaults to on, 5 minutes and 50k tokens, and clamps bad values', () => {
    expect(forkCacheColdConfig(undefined)).toEqual({
      enabled: true,
      windowMinutes: 5,
      threshold: 50_000
    })
    expect(
      forkCacheColdConfig({
        forkCacheColdCue: false,
        forkCacheWindowMinutes: 0,
        forkCacheColdThresholdTokens: -3
      })
    ).toEqual({ enabled: false, windowMinutes: 1, threshold: 0 })
    expect(forkUsageRetentionDays(undefined)).toBe(90)
    expect(forkUsageRetentionDays({ forkUsageRetentionDays: Number.NaN })).toBe(90)
  })
})

describe('forkCacheColdVerdict', () => {
  const config = forkCacheColdConfig(undefined)

  it('turns cold once the window passes, not before', () => {
    expect(forkCacheColdVerdict(state(), config, T0 + 5 * MINUTE - 1)).toEqual({ cold: false })
    expect(forkCacheColdVerdict(state(), config, T0 + 5 * MINUTE)).toEqual({
      cold: true,
      tokens: 120_000,
      idleMs: 5 * MINUTE
    })
  })

  it('uses a reported 1 h lifetime over the setting', () => {
    const hour = state({ ttl: '1h' })
    expect(forkCacheColdVerdict(hour, config, T0 + 30 * MINUTE).cold).toBe(false)
    expect(forkCacheColdVerdict(hour, config, T0 + 60 * MINUTE).cold).toBe(true)
  })

  it('uses the setting when the lifetime is unknown', () => {
    const custom = forkCacheColdConfig({ forkCacheWindowMinutes: 15 })
    expect(forkCacheColdVerdict(state(), custom, T0 + 10 * MINUTE).cold).toBe(false)
    expect(forkCacheColdVerdict(state(), custom, T0 + 15 * MINUTE).cold).toBe(true)
  })

  it('stays quiet while working, below the threshold, or switched off', () => {
    const late = T0 + 99 * MINUTE
    expect(forkCacheColdVerdict(state({ working: true }), config, late).cold).toBe(false)
    expect(forkCacheColdVerdict(state({ contextTokens: 49_999 }), config, late).cold).toBe(false)
    expect(
      forkCacheColdVerdict(state(), forkCacheColdConfig({ forkCacheColdCue: false }), late).cold
    ).toBe(false)
    expect(forkCacheColdVerdict(undefined, config, late).cold).toBe(false)
  })

  it('says how long until the window runs out', () => {
    expect(forkCacheColdInMs(state(), config, T0 + MINUTE)).toBe(4 * MINUTE)
    expect(forkCacheColdInMs(state(), config, T0 + 9 * MINUTE)).toBe(0)
    expect(forkCacheColdInMs(state({ working: true }), config, T0)).toBeNull()
  })
})

describe('formatForkTokens', () => {
  it('rounds to k and M', () => {
    expect(formatForkTokens(950)).toBe('950')
    expect(formatForkTokens(12_400)).toBe('12k')
    expect(formatForkTokens(1_250_000)).toBe('1.3M')
    expect(formatForkTokens(12_000_000)).toBe('12M')
  })
})
