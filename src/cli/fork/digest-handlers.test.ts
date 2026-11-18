import { describe, expect, it } from 'vitest'
import { readDigestSince } from './digest-handlers'
import { FORK_DIGEST_COMMAND_SPECS } from './digest-specs'

describe('orca digest', () => {
  const now = Date.UTC(2026, 10, 18, 9)

  it('reads --since as a duration or a date, and leaves it out when absent', () => {
    expect(readDigestSince(undefined, now)).toBeUndefined()
    expect(readDigestSince('12h', now)).toBe(now - 12 * 3_600_000)
    expect(readDigestSince('2026-11-17T00:00:00Z', now)).toBe(Date.UTC(2026, 10, 17))
  })

  it('refuses a --since it cannot read', () => {
    expect(() => readDigestSince('last tuesday', now)).toThrow(/--since takes/)
  })

  it('takes only --since and the global flags', () => {
    const [spec] = FORK_DIGEST_COMMAND_SPECS
    expect(spec.path).toEqual(['digest'])
    expect(spec.allowedFlags).toContain('since')
    expect(spec.allowedFlags).not.toContain('until')
  })
})
