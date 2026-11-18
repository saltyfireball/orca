// Pooled limits (FORK.md, SLRM-2392): this machine's Claude and Codex accounts as usage numbers
// only, read from the same accounts snapshot the usage roster shows. Emails and org ids leave as
// hashes (the label is the account's name or email, as `accounts.list` already shows it); tokens
// and credential paths are never read here. Keep electron out of this file (the headless server
// bundles it).
import { createHash } from 'node:crypto'
import type {
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState
} from '../../../shared/agent-accounts/managed-account-types'
import type {
  ProviderRateLimits,
  RateLimitState,
  RateLimitWindow
} from '../../../shared/agent-usage/rate-limits/rate-limit-types'
import type {
  PooledAccountReading,
  PooledAccountWindow,
  PooledLimitsProvider
} from '../../../shared/fork/pooled-limits'

export type PooledLimitsSnapshot = {
  claude: ClaudeRateLimitAccountsState
  codex: CodexRateLimitAccountsState
  rateLimits: RateLimitState | null
}

/** The Claude login of the default folder, for a host with no saved accounts. */
export type DefaultClaudeLogin = { email: string; organizationUuid: string | null } | null

export function pooledIdentityKey(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex').slice(0, 32)
}

function window(value: RateLimitWindow | null | undefined): PooledAccountWindow | null {
  return value && Number.isFinite(value.usedPercent)
    ? { usedPercent: value.usedPercent, resetsAt: value.resetsAt ?? null }
    : null
}

type Identity = { email: string; org: string | null; label: string }

function reading(
  provider: PooledLimitsProvider,
  identity: Identity,
  limits: ProviderRateLimits | null | undefined
): PooledAccountReading {
  const session = window(limits?.session)
  const weekly = window(limits?.weekly)
  return {
    provider,
    emailKey: pooledIdentityKey(identity.email),
    orgKey: identity.org ? pooledIdentityKey(identity.org) : null,
    label: identity.label.slice(0, 200),
    plan: limits?.planType ? limits.planType.slice(0, 40) : null,
    session,
    weekly,
    updatedAt: session || weekly ? (limits?.updatedAt ?? 0) : 0
  }
}

/** The account id the active reading belongs to on its runtime; null is System default. */
function activeAccountId(
  limits: ProviderRateLimits | null | undefined,
  state: {
    activeAccountId: string | null
    activeAccountIdsByRuntime?: { host: string | null; wsl: Record<string, string | null> }
  },
  target: { runtime: 'host' | 'wsl'; wslDistro: string | null } | undefined
): string | null {
  const read = limits?.usageMetadata?.readingAccount
  if (read) {
    return read.accountId
  }
  const byRuntime = state.activeAccountIdsByRuntime
  if (byRuntime && target) {
    return target.runtime === 'wsl'
      ? (byRuntime.wsl[target.wslDistro ?? ''] ?? null)
      : byRuntime.host
  }
  return state.activeAccountId
}

function savedReadings(
  provider: PooledLimitsProvider,
  accounts: readonly { id: string; email: string; displayName?: string; org: string | null }[],
  active: { id: string | null; limits: ProviderRateLimits | null | undefined },
  inactive: readonly { accountId: string; rateLimits: ProviderRateLimits | null }[]
): PooledAccountReading[] {
  return accounts
    .filter((account) => account.email.trim().length > 0)
    .map((account) =>
      reading(
        provider,
        { email: account.email, org: account.org, label: account.displayName || account.email },
        active.id === account.id
          ? active.limits
          : inactive.find((entry) => entry.accountId === account.id)?.rateLimits
      )
    )
}

export function readPooledMachineAccounts(
  snapshot: PooledLimitsSnapshot,
  defaultClaudeLogin: DefaultClaudeLogin
): PooledAccountReading[] {
  const limits = snapshot.rateLimits
  const out: PooledAccountReading[] = []

  const claudeActive = activeAccountId(limits?.claude, snapshot.claude, limits?.claudeTarget)
  out.push(
    ...savedReadings(
      'claude',
      snapshot.claude.accounts.map((account) => ({
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        org: account.organizationUuid ?? null
      })),
      { id: claudeActive, limits: limits?.claude },
      limits?.inactiveClaudeAccounts ?? []
    )
  )
  if (claudeActive === null) {
    const email = snapshot.claude.systemDefaultEmail ?? defaultClaudeLogin?.email
    const org =
      snapshot.claude.systemDefaultOrganizationUuid ?? defaultClaudeLogin?.organizationUuid ?? null
    if (email) {
      out.push(reading('claude', { email, org, label: email }, limits?.claude))
    }
  }

  const codexActive = activeAccountId(limits?.codex, snapshot.codex, limits?.codexTarget)
  out.push(
    ...savedReadings(
      'codex',
      snapshot.codex.accounts.map((account) => ({
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        org: account.providerAccountId ?? account.workspaceAccountId ?? null
      })),
      { id: codexActive, limits: limits?.codex },
      limits?.inactiveCodexAccounts ?? []
    )
  )
  const system = snapshot.codex.systemDefault
  if (codexActive === null && system?.authKind === 'oauth' && system.email) {
    out.push(
      reading(
        'codex',
        { email: system.email, org: system.providerAccountId, label: system.email },
        limits?.codex
      )
    )
  }
  return out
}
