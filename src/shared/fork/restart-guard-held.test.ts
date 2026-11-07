import { describe, expect, it } from 'vitest'
import { isForkRestartHeld } from './restart-guard-held'

describe('isForkRestartHeld', () => {
  it('matches only the held results main sends', () => {
    expect(isForkRestartHeld({ forkRestartHeld: 'waiting' })).toBe(true)
    expect(isForkRestartHeld({ forkRestartHeld: 'cancelled' })).toBe(true)
    expect(isForkRestartHeld(undefined)).toBe(false)
    expect(isForkRestartHeld({ forkRestartHeld: 'proceed' })).toBe(false)
  })
})
