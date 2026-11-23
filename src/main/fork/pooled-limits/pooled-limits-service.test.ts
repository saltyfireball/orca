import { describe, expect, it, vi } from 'vitest'
import type { PooledAccountReading } from '../../../shared/fork/pooled-limits'
import {
  parseMachineUsage,
  readForkMachineUsage,
  readForkPooledLimits,
  type PooledLimitsDeps
} from './pooled-limits-service'

const NOW = 10_000_000

function reading(overrides: Partial<PooledAccountReading> = {}): PooledAccountReading {
  return {
    provider: 'claude',
    emailKey: 'abcdef0123456789',
    orgKey: null,
    label: 'a@example.com',
    plan: null,
    session: { usedPercent: 50, resetsAt: NOW + 60_000 },
    weekly: null,
    updatedAt: NOW - 10,
    ...overrides
  }
}

function deps(overrides: Partial<PooledLimitsDeps> = {}): PooledLimitsDeps {
  return {
    settings: () => null,
    snapshot: () => ({
      claude: { accounts: [], activeAccountId: null },
      codex: { accounts: [], activeAccountId: null },
      rateLimits: null
    }),
    refresh: vi.fn(async () => undefined),
    defaultClaudeLogin: async () => null,
    listEnvironments: () => [],
    callEnvironment: vi.fn(async () => ({ accounts: [] })),
    now: () => NOW,
    ...overrides
  }
}

describe('parseMachineUsage', () => {
  it('keeps well-formed readings and drops the rest', () => {
    const parsed = parseMachineUsage({
      accounts: [
        reading(),
        { ...reading(), emailKey: 'not hex!' },
        { ...reading(), token: 'x', provider: 'gemini' },
        'junk'
      ]
    })
    expect(parsed?.accounts).toHaveLength(1)
    expect(parsed?.accounts[0]).not.toHaveProperty('token')
    expect(parseMachineUsage(null)).toBeNull()
    expect(parseMachineUsage({ off: true })).toEqual({ off: true, accounts: [] })
  })

  it('strips control characters and caps a reading dated far ahead', () => {
    const parsed = parseMachineUsage(
      { accounts: [{ ...reading(), label: 'a\u001b]0;x\u0007b', updatedAt: NOW * 10 }] },
      NOW
    )
    expect(parsed?.accounts[0].label).toBe('a ]0;x b')
    expect(parsed?.accounts[0].updatedAt).toBe(NOW + 5 * 60_000)
  })
})

describe('readForkMachineUsage', () => {
  it('shares nothing when the setting is off', async () => {
    const result = await readForkMachineUsage(
      deps({ settings: () => ({ forkPooledLimits: false }) }),
      {}
    )
    expect(result).toEqual({ off: true, accounts: [] })
  })

  it('refreshes first when asked', async () => {
    const d = deps()
    await readForkMachineUsage(d, { refresh: true })
    expect(d.refresh).toHaveBeenCalledOnce()
  })
})

describe('readForkPooledLimits', () => {
  it('asks every paired server and reports each one', async () => {
    const callEnvironment = vi.fn(async (id: string) => {
      if (id === 'alpha') {
        return { accounts: [reading()] }
      }
      if (id === 'stock') {
        throw Object.assign(new Error('nope'), { code: 'method_not_found' })
      }
      if (id === 'off') {
        return { off: true, accounts: [] }
      }
      throw new Error('timeout')
    })
    const result = await readForkPooledLimits(
      deps({
        listEnvironments: () => [
          { id: 'alpha', name: 'alpha' },
          { id: 'stock', name: 'stock' },
          { id: 'off', name: 'off' },
          { id: 'gone', name: 'gone' }
        ],
        callEnvironment
      }),
      {}
    )
    expect(callEnvironment).toHaveBeenCalledWith('alpha', 'fork.limits.machineUsage', {}, 4000)
    expect(result.machines.map((m) => [m.name, m.status, m.accounts])).toEqual([
      ['this machine', 'ok', 0],
      ['alpha', 'ok', 1],
      ['stock', 'no-probe', 0],
      ['off', 'off', 0],
      ['gone', 'unreachable', 0]
    ])
    expect(result.providers[0].accounts[0].machines).toEqual(['alpha'])
  })

  it('stays on this machine with local, or with servers turned off', async () => {
    const callEnvironment = vi.fn(async () => ({ accounts: [] }))
    const listEnvironments = (): { id: string; name: string }[] => [{ id: 'alpha', name: 'alpha' }]
    await readForkPooledLimits(deps({ listEnvironments, callEnvironment }), { local: true })
    await readForkPooledLimits(
      deps({
        listEnvironments,
        callEnvironment,
        settings: () => ({ forkPooledLimitsServers: false })
      }),
      {}
    )
    expect(callEnvironment).not.toHaveBeenCalled()
  })

  it('is off when the setting is off', async () => {
    const result = await readForkPooledLimits(
      deps({ settings: () => ({ forkPooledLimits: false }) }),
      {}
    )
    expect(result).toEqual({ now: NOW, off: true, providers: [], machines: [] })
  })
})
