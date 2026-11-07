import { describe, expect, it, vi } from 'vitest'
import type {
  ClaudeManagedAccount,
  ClaudeManagedAccountSummary,
  ClaudeRateLimitAccountsState
} from '../../../../shared/managed-account-types'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { ClaudeChipEvidence } from './claude-chip-evidence'
import type { ChatHomeEntry, ClaudeHostSnapshot } from './claude-chip-host-cache'

vi.mock('@/runtime/runtime-provider-accounts-client', () => ({
  fetchProviderAccountsSnapshot: vi.fn()
}))
vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: vi.fn()
}))

const { accountColourForId, combineResolutions, SYSTEM_DEFAULT_ACCOUNT_ID } =
  await import('./claude-account-identity')
const { resolveAllEvidence, resolveEvidence } = await import('./claude-chip-resolve')

const LOCAL: RuntimeClientTarget = { kind: 'local' }
const KIF: RuntimeClientTarget = { kind: 'environment', environmentId: 'env-kif' }

function saved(id: string, email: string, extra: Partial<ClaudeManagedAccount> = {}) {
  const account: ClaudeManagedAccount = {
    id,
    email,
    managedAuthPath: `/Users/j/orca/claude-accounts/${id}`,
    authMethod: 'subscription-oauth',
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1,
    ...extra
  }
  return account
}

function summary(id: string, email: string, home: string, organizationUuid = 'org-1') {
  const account: ClaudeManagedAccountSummary = {
    id,
    email,
    authMethod: 'subscription-oauth',
    organizationUuid,
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1,
    home
  }
  return account
}

const localSaved = [saved('acct-a', 'alice@example.com')]
const localHost: ClaudeRateLimitAccountsState = {
  accounts: [summary('acct-a', 'alice@example.com', '/Users/j/orca/claude-accounts/acct-a')],
  activeAccountId: 'acct-a',
  systemDefaultEmail: 'bob@example.com',
  systemDefaultOrganizationUuid: 'org-1',
  systemDefaultHome: '/Users/j/.claude'
}
// A fake remote owner: kif keeps its own accounts, which this desktop never saved.
const kifHost: ClaudeRateLimitAccountsState = {
  accounts: [summary('acct-a', 'bea@kif.example', '/home/j/.orca/claude/acct-a')],
  activeAccountId: null,
  systemDefaultEmail: 'carl@kif.example',
  systemDefaultOrganizationUuid: 'org-2',
  systemDefaultHome: '/home/j/.claude'
}

function lookups(chatHomes: Record<string, ChatHomeEntry> = {}, hosts = true) {
  return {
    host: (target: RuntimeClientTarget): ClaudeHostSnapshot | undefined =>
      hosts
        ? { claude: target.kind === 'local' ? localHost : kifHost, rateLimits: null }
        : undefined,
    chatHome: (_target: RuntimeClientTarget, sessionId: string): ChatHomeEntry =>
      chatHomes[sessionId] ?? 'loading'
  }
}

const localPane = (transcriptPath: string): ClaudeChipEvidence => ({
  transport: LOCAL,
  ownerTarget: LOCAL,
  wslHostDistro: null,
  hostLabel: null,
  transcriptPath
})
const kifPane = (transcriptPath: string): ClaudeChipEvidence => ({
  transport: KIF,
  ownerTarget: KIF,
  wslHostDistro: null,
  hostLabel: 'kif',
  transcriptPath
})
const kifChat = (chatSessionId: string): ClaudeChipEvidence => ({
  transport: KIF,
  ownerTarget: KIF,
  wslHostDistro: null,
  hostLabel: 'kif',
  chatSessionId
})

function label(evidence: ClaudeChipEvidence, homes: Record<string, ChatHomeEntry> = {}) {
  const resolution = resolveEvidence(evidence, localSaved, lookups(homes))
  return resolution.kind === 'account' ? resolution.account.label : resolution.kind
}

describe('account chip resolution', () => {
  it('names a local terminal pane by its saved folder and System default by its login', () => {
    expect(label(localPane('/Users/j/orca/claude-accounts/acct-a/projects/w/s.jsonl'))).toBe('A')
    expect(label(localPane('/Users/j/.claude/projects/w/s.jsonl'))).toBe('B')
    expect(label(localPane('/Users/j/elsewhere/projects/w/s.jsonl'))).toBe('unknown')
  })

  it('resolves a remote pane against the remote host, labelled with the host', () => {
    expect(label(kifPane('/home/j/.orca/claude/acct-a/projects/w/s.jsonl'))).toBe('B @ kif')
    expect(label(kifPane('/home/j/.claude/projects/w/s.jsonl'))).toBe('C @ kif')
    // The desktop's own folder means nothing on kif.
    expect(label(kifPane('/Users/j/orca/claude-accounts/acct-a/projects/w/s.jsonl'))).toBe(
      'unknown'
    )
  })

  it('maps a System default folder signed in to a saved login onto that account', () => {
    const host: ClaudeRateLimitAccountsState = {
      ...localHost,
      systemDefaultEmail: 'alice@example.com'
    }
    const resolution = resolveEvidence(
      localPane('/Users/j/.claude/projects/w/s.jsonl'),
      [...localSaved, saved('acct-z', 'zed@example.com')],
      { ...lookups(), host: () => ({ claude: host, rateLimits: null }) }
    )
    expect(resolution.kind === 'account' && resolution.account.id).toBe('acct-a')
  })

  it('draws nothing when the host has one account', () => {
    const lone: ClaudeRateLimitAccountsState = {
      accounts: [],
      activeAccountId: null,
      systemDefaultEmail: 'carl@kif.example',
      systemDefaultHome: '/home/j/.claude'
    }
    const resolution = resolveEvidence(kifPane('/home/j/.claude/projects/w/s.jsonl'), localSaved, {
      ...lookups(),
      host: () => ({ claude: lone, rateLimits: null })
    })
    expect(resolution.kind).toBe('none')
  })

  it('reads a native chat from the home its host reports', () => {
    expect(label(kifChat('s1'))).toBe('none')
    expect(label(kifChat('s1'), { s1: { home: null, accountId: null } })).toBe('none')
    expect(label(kifChat('s1'), { s1: { home: '/home/j/.claude', accountId: null } })).toBe(
      'C @ kif'
    )
    expect(label(kifChat('s1'), { s1: { home: '/x', accountId: 'acct-a' } })).toBe('B @ kif')
    const failed = resolveEvidence(kifChat('s1'), localSaved, lookups({ s1: 'failed' }))
    expect(failed).toEqual({ kind: 'unknown', ownerKey: 'environment:env-kif', hostLabel: 'kif' })
  })

  it('uses only the saved accounts of a WSL host distro', () => {
    const wsl = [
      ...localSaved,
      saved('acct-w', 'wendy@example.com', {
        managedAuthRuntime: 'wsl',
        wslDistro: 'Ubuntu',
        wslLinuxAuthPath: '/home/j/.orca/acct-w'
      })
    ]
    const evidence: ClaudeChipEvidence = {
      transport: { kind: 'environment', environmentId: 'env-wsl' },
      ownerTarget: LOCAL,
      wslHostDistro: 'Ubuntu',
      hostLabel: 'Ubuntu',
      transcriptPath: '/home/j/.orca/acct-w/projects/w/s.jsonl'
    }
    const resolution = resolveEvidence(evidence, wsl, lookups())
    expect(resolution.kind === 'account' && resolution.account).toMatchObject({
      id: 'acct-w',
      ownerKey: 'local:wsl:Ubuntu',
      label: 'W @ Ubuntu'
    })
  })

  it('keeps mixed state per host: one id on two hosts is two accounts', () => {
    const same = resolveAllEvidence(
      [
        localPane('/Users/j/orca/claude-accounts/acct-a/projects/w/1.jsonl'),
        localPane('/Users/j/orca/claude-accounts/acct-a/projects/w/2.jsonl')
      ],
      localSaved,
      lookups()
    )
    expect(same.kind).toBe('account')
    const mixed = resolveAllEvidence(
      [
        localPane('/Users/j/orca/claude-accounts/acct-a/projects/w/1.jsonl'),
        kifPane('/home/j/.orca/claude/acct-a/projects/w/2.jsonl')
      ],
      localSaved,
      lookups()
    )
    expect(mixed.kind === 'mixed' && mixed.accounts.map((account) => account.label)).toEqual([
      'A',
      'B @ kif'
    ])
  })

  it('prefers a known account over unknown sessions and keeps colours stable', () => {
    const combined = combineResolutions([
      { kind: 'unknown', ownerKey: 'local', hostLabel: null },
      resolveEvidence(
        localPane('/Users/j/orca/claude-accounts/acct-a/projects/w/1.jsonl'),
        localSaved,
        lookups()
      )
    ])
    expect(combined.kind).toBe('account')
    expect(accountColourForId('acct-a')).toBe(accountColourForId('acct-a'))
    expect(accountColourForId('acct-a')).not.toBe(accountColourForId(SYSTEM_DEFAULT_ACCOUNT_ID))
  })

  it('guesses System default plus saved accounts before the host answers', () => {
    const resolution = resolveEvidence(
      localPane('/Users/j/orca/claude-accounts/acct-a/projects/w/1.jsonl'),
      localSaved,
      lookups({}, false)
    )
    expect(resolution.kind === 'account' && resolution.account.label).toBe('A')
  })
})
