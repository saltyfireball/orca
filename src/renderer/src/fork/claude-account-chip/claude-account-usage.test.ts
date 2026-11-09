import { describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits, RateLimitState } from '../../../../shared/rate-limit-types'
import type { ClaudeHostSnapshot } from './claude-chip-host-cache'

vi.mock('@/store', () => ({ useAppStore: vi.fn() }))
vi.mock('@/runtime/provider-accounts/observations/runtime-provider-accounts-client', () => ({
  fetchProviderAccountsSnapshot: vi.fn()
}))
vi.mock('@/runtime/native-chat/requests/structured-agent-session-call', () => ({
  callStructuredAgentSession: vi.fn()
}))

const { accountUsage, ownerPlace } = await import('./claude-account-usage')
const { SYSTEM_DEFAULT_ACCOUNT_ID } = await import('./claude-account-identity')

function limits(usedPercent: number): ProviderRateLimits {
  return {
    provider: 'claude',
    session: { usedPercent, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: null,
    updatedAt: 1,
    error: null,
    status: 'ok'
  }
}

function state(overrides: Partial<RateLimitState>): RateLimitState {
  return {
    claude: null,
    codex: null,
    gemini: null,
    opencodeGo: null,
    kimi: null,
    antigravity: null,
    minimax: null,
    grok: null,
    cursor: null,
    zcode: null,
    muse: null,
    minimaxCookieConfigured: false,
    minimaxApiKeyConfigured: false,
    opencodeGoApiKeyConfigured: false,
    grokAuthConfigured: false,
    cursorAuthConfigured: false,
    claudeTarget: { runtime: 'host', wslDistro: null },
    codexTarget: { runtime: 'host', wslDistro: null },
    inactiveClaudeAccounts: [],
    inactiveCodexAccounts: [],
    antigravityAccounts: [],
    ...overrides
  }
}

const localState = state({
  claude: limits(10),
  inactiveClaudeAccounts: [
    { accountId: 'acct-b', rateLimits: limits(20), updatedAt: 1, isFetching: false }
  ]
})
const localSettings = {
  activeClaudeManagedAccountId: 'acct-a',
  activeClaudeManagedAccountIdsByRuntime: { host: 'acct-a', wsl: { Ubuntu: 'acct-w' } }
}
const kif: ClaudeHostSnapshot = {
  claude: { accounts: [], activeAccountId: null },
  rateLimits: state({
    claude: limits(70),
    inactiveClaudeAccounts: [
      { accountId: 'acct-a', rateLimits: limits(80), updatedAt: 1, isFetching: false }
    ]
  })
}

function used(id: string, ownerKey: string): number | undefined {
  return accountUsage(
    { id, ownerKey },
    { rateLimits: localState, settings: localSettings },
    ownerKey.startsWith('environment:') ? kif : undefined
  )?.session?.usedPercent
}

describe('account chip usage', () => {
  it('splits owner keys into this desktop, its WSL distros and remote hosts', () => {
    expect(ownerPlace('local')).toEqual({ kind: 'local', distro: null })
    expect(ownerPlace('local:wsl:Ubuntu')).toEqual({ kind: 'local', distro: 'Ubuntu' })
    expect(ownerPlace('environment:env-kif')).toEqual({
      kind: 'remote',
      target: { kind: 'environment', environmentId: 'env-kif' }
    })
  })

  it('reads local accounts from the usage store', () => {
    expect(used('acct-a', 'local')).toBe(10)
    expect(used('acct-b', 'local')).toBe(20)
    expect(used(SYSTEM_DEFAULT_ACCOUNT_ID, 'local')).toBeUndefined()
    // The meter reads the host, so the WSL distro's active account has no reading.
    expect(used('acct-w', 'local:wsl:Ubuntu')).toBeUndefined()
  })

  it('reads a remote account from that host, never the desktop', () => {
    expect(used(SYSTEM_DEFAULT_ACCOUNT_ID, 'environment:env-kif')).toBe(70)
    expect(used('acct-a', 'environment:env-kif')).toBe(80)
    expect(used('acct-b', 'environment:env-kif')).toBeUndefined()
  })
})
