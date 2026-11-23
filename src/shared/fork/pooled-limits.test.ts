import { describe, expect, it } from 'vitest'
import {
  poolForkLimits,
  readForkPooledLimitsSettings,
  type PooledAccountReading
} from './pooled-limits'

const NOW = 1_000_000_000
const HOUR = 3_600_000

function account(overrides: Partial<PooledAccountReading>): PooledAccountReading {
  return {
    provider: 'claude',
    emailKey: 'aaaaaaaa',
    orgKey: null,
    label: 'a@example.com',
    plan: null,
    session: null,
    weekly: null,
    updatedAt: NOW - 1000,
    ...overrides
  }
}

describe('poolForkLimits', () => {
  it('counts the same account on two machines once, with its freshest reading', () => {
    const rows = poolForkLimits(
      [
        {
          machineName: 'this machine',
          accounts: [
            account({ session: { usedPercent: 10, resetsAt: NOW + HOUR }, updatedAt: NOW - 5000 })
          ]
        },
        {
          machineName: 'alpha',
          accounts: [
            account({ session: { usedPercent: 40, resetsAt: NOW + HOUR }, updatedAt: NOW - 100 })
          ]
        }
      ],
      NOW
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].accounts).toHaveLength(1)
    expect(rows[0].accounts[0].machines).toEqual(['alpha', 'this machine'])
    expect(rows[0].windows[0]).toMatchObject({ kind: 'session', usedPercent: 40, accounts: 1 })
  })

  it('matches a missing org to a known one, but keeps two different orgs apart', () => {
    const rows = poolForkLimits(
      [
        {
          machineName: 'a',
          accounts: [account({ orgKey: 'org11111' }), account({ orgKey: 'org22222' })]
        },
        { machineName: 'b', accounts: [account({ orgKey: null })] }
      ],
      NOW
    )
    expect(rows[0].accounts).toHaveLength(2)
    expect(rows[0].accounts.flatMap((a) => a.machines).sort()).toEqual(['a', 'a', 'b'])
  })

  it('pools windows as the mean and names the next reset and what it frees', () => {
    const rows = poolForkLimits(
      [
        {
          machineName: 'this machine',
          accounts: [
            account({
              emailKey: 'aaaaaaaa',
              session: { usedPercent: 80, resetsAt: NOW + HOUR },
              weekly: { usedPercent: 50, resetsAt: NOW + 48 * HOUR }
            }),
            account({
              emailKey: 'bbbbbbbb',
              label: 'b',
              session: { usedPercent: 20, resetsAt: NOW + 3 * HOUR },
              weekly: { usedPercent: 10, resetsAt: NOW + 24 * HOUR }
            }),
            account({ emailKey: 'cccccccc', label: 'c', provider: 'codex' })
          ]
        }
      ],
      NOW
    )
    const claude = rows.find((row) => row.provider === 'claude')
    expect(claude?.windows).toEqual([
      { kind: 'session', usedPercent: 50, accounts: 2, nextResetAt: NOW + HOUR, freesPercent: 40 },
      {
        kind: 'weekly',
        usedPercent: 30,
        accounts: 2,
        nextResetAt: NOW + 24 * HOUR,
        freesPercent: 5
      }
    ])
    const codex = rows.find((row) => row.provider === 'codex')
    expect(codex?.accounts).toHaveLength(1)
    expect(codex?.windows).toEqual([])
  })

  it('reads a window whose reset has passed as unused', () => {
    const rows = poolForkLimits(
      [
        {
          machineName: 'x',
          accounts: [account({ session: { usedPercent: 90, resetsAt: NOW - 1 } })]
        }
      ],
      NOW
    )
    expect(rows[0].windows[0]).toMatchObject({ usedPercent: 0, nextResetAt: null, freesPercent: 0 })
  })
})

describe('readForkPooledLimitsSettings', () => {
  it('is on unless set false', () => {
    expect(readForkPooledLimitsSettings(null)).toEqual({ enabled: true, servers: true })
    expect(
      readForkPooledLimitsSettings({ forkPooledLimits: false, forkPooledLimitsServers: false })
    ).toEqual({ enabled: false, servers: false })
  })
})
