import { describe, expect, it } from 'vitest'
import {
  FORK_USAGE_LIMITS_COMMAND,
  isForkUsageLimitsDraft,
  withForkUsageLimitsCommand
} from './use-fork-usage-limits-command'

describe('/usage-limits', () => {
  it('matches only the bare command', () => {
    expect(isForkUsageLimitsDraft('/usage-limits')).toBe(true)
    expect(isForkUsageLimitsDraft('  /Usage-Limits  ')).toBe(true)
    expect(isForkUsageLimitsDraft('/usage')).toBe(false)
    expect(isForkUsageLimitsDraft('/usage-limits please')).toBe(false)
  })

  it('adds one Orca-owned row in place of an agent command of the same name', () => {
    const rows = withForkUsageLimitsCommand(
      [{ name: 'clear' }, { name: FORK_USAGE_LIMITS_COMMAND, description: 'agent' }],
      true
    )
    expect(rows.map((row) => [row.name, row.orcaOwned === true])).toEqual([
      ['clear', false],
      [FORK_USAGE_LIMITS_COMMAND, true]
    ])
    expect(withForkUsageLimitsCommand([{ name: 'clear' }], false)).toEqual([{ name: 'clear' }])
  })
})
