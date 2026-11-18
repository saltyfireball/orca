import { describe, expect, it } from 'vitest'
import type {
  ProviderRateLimits,
  RateLimitState
} from '../../../shared/agent-usage/rate-limits/rate-limit-types'
import {
  pooledIdentityKey,
  readPooledMachineAccounts,
  type PooledLimitsSnapshot
} from './pooled-limits-machine'

function limits(
  provider: 'claude' | 'codex',
  used: number,
  accountId?: string
): ProviderRateLimits {
  return {
    provider,
    session: { usedPercent: used, windowMinutes: 300, resetsAt: 5000, resetDescription: null },
    weekly: { usedPercent: used / 2, windowMinutes: 10080, resetsAt: 9000, resetDescription: null },
    updatedAt: 1234,
    error: null,
    status: 'ok',
    ...(accountId
      ? { usageMetadata: { readingAccount: { accountId, runtime: 'host', wslDistro: null } } }
      : {})
  }
}

function snapshot(overrides: Partial<PooledLimitsSnapshot> = {}): PooledLimitsSnapshot {
  return {
    claude: {
      accounts: [
        {
          id: 'c1',
          email: 'Alice@Example.com',
          displayName: 'Work',
          authMethod: 'subscription-oauth',
          organizationUuid: 'org-1',
          createdAt: 0,
          updatedAt: 0,
          lastAuthenticatedAt: 0,
          home: '/secret/home/path'
        },
        {
          id: 'c2',
          email: 'bob@example.com',
          authMethod: 'subscription-oauth',
          createdAt: 0,
          updatedAt: 0,
          lastAuthenticatedAt: 0
        }
      ],
      activeAccountId: 'c1',
      activeAccountIdsByRuntime: { host: 'c1', wsl: {} }
    },
    codex: { accounts: [], activeAccountId: null },
    rateLimits: {
      claude: limits('claude', 40, 'c1'),
      codex: null,
      inactiveClaudeAccounts: [
        { accountId: 'c2', rateLimits: limits('claude', 10), updatedAt: 1, isFetching: false }
      ],
      inactiveCodexAccounts: [],
      claudeTarget: { runtime: 'host', wslDistro: null },
      codexTarget: { runtime: 'host', wslDistro: null }
    } as unknown as RateLimitState,
    ...overrides
  }
}

describe('readPooledMachineAccounts', () => {
  it('reports each saved account with its own reading, identities hashed', () => {
    const out = readPooledMachineAccounts(snapshot(), null)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      provider: 'claude',
      emailKey: pooledIdentityKey('alice@example.com'),
      orgKey: pooledIdentityKey('org-1'),
      label: 'Work',
      plan: null,
      session: { usedPercent: 40, resetsAt: 5000 },
      weekly: { usedPercent: 20, resetsAt: 9000 },
      updatedAt: 1234
    })
    expect(out[1]).toMatchObject({ label: 'bob@example.com', session: { usedPercent: 10 } })
    const wire = JSON.stringify(out)
    expect(wire).not.toContain('/secret/home/path')
    expect(wire).not.toContain('org-1')
  })

  it('reports System default by its login, and Codex System default when signed in', () => {
    const out = readPooledMachineAccounts(
      snapshot({
        claude: { accounts: [], activeAccountId: null },
        codex: {
          accounts: [],
          activeAccountId: null,
          systemDefault: {
            hasAuth: true,
            authKind: 'oauth',
            email: 'c@example.com',
            providerAccountId: 'acct',
            workspaceLabel: null
          }
        },
        rateLimits: {
          ...snapshot().rateLimits,
          claude: limits('claude', 70),
          codex: limits('codex', 30),
          inactiveClaudeAccounts: []
        } as RateLimitState
      }),
      { email: 'solo@example.com', organizationUuid: null }
    )
    expect(out.map((entry) => [entry.provider, entry.label, entry.session?.usedPercent])).toEqual([
      ['claude', 'solo@example.com', 70],
      ['codex', 'c@example.com', 30]
    ])
  })

  it('leaves out a Codex System default on an API key', () => {
    const out = readPooledMachineAccounts(
      snapshot({
        claude: { accounts: [], activeAccountId: null },
        codex: {
          accounts: [],
          activeAccountId: null,
          systemDefault: {
            hasAuth: true,
            authKind: 'api-key',
            email: null,
            providerAccountId: null,
            workspaceLabel: null
          }
        }
      }),
      null
    )
    expect(out).toEqual([])
  })
})
