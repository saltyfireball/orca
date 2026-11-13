// SLRM-1503: the 5h and weekly usage the chip's hover shows, read from the host that runs the
// session: this desktop's usage store, or the remote host's accounts snapshot.
import { useCallback, useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import { recomputeOn } from '@/lib/recompute-on'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { ProviderRateLimits, RateLimitState } from '../../../../shared/rate-limit-types'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { SYSTEM_DEFAULT_ACCOUNT_ID, type ForkClaudeAccount } from './claude-account-identity'
import {
  getClaudeChipCacheVersion,
  getClaudeHostSnapshot,
  loadClaudeHost,
  subscribeClaudeChipCache,
  type ClaudeHostSnapshot
} from './claude-chip-host-cache'

type OwnerPlace =
  | { kind: 'local'; distro: string | null }
  | { kind: 'remote'; target: RuntimeClientTarget }

export function ownerPlace(ownerKey: string): OwnerPlace {
  if (ownerKey.startsWith('environment:')) {
    return {
      kind: 'remote',
      target: {
        kind: 'environment',
        environmentId: ownerKey.slice('environment:'.length)
      }
    }
  }
  return {
    kind: 'local',
    distro: ownerKey.startsWith('local:wsl:') ? ownerKey.slice('local:wsl:'.length) : null
  }
}

type ActiveSelection = Pick<
  GlobalSettings,
  'activeClaudeManagedAccountId' | 'activeClaudeManagedAccountIdsByRuntime'
>

function readUsage(
  accountId: string,
  activeId: string | null,
  runtimeMatches: boolean,
  state: RateLimitState | null | undefined
): ProviderRateLimits | null {
  if (!state) {
    return null
  }
  if (accountId === (activeId ?? SYSTEM_DEFAULT_ACCOUNT_ID)) {
    return runtimeMatches ? state.claude : null
  }
  return (
    state.inactiveClaudeAccounts.find((entry) => entry.accountId === accountId)?.rateLimits ?? null
  )
}

/** Usage for one account on its own host; null when that host has no reading for it. */
export function accountUsage(
  account: Pick<ForkClaudeAccount, 'id' | 'ownerKey'>,
  local: {
    rateLimits: RateLimitState
    settings: ActiveSelection | null | undefined
  },
  remote: ClaudeHostSnapshot | undefined
): ProviderRateLimits | null {
  const place = ownerPlace(account.ownerKey)
  if (place.kind === 'remote') {
    const claude = remote?.claude
    const activeId = claude
      ? (claude.activeAccountIdsByRuntime?.host ?? claude.activeAccountId)
      : null
    return readUsage(
      account.id,
      activeId,
      remote?.rateLimits?.claudeTarget.runtime !== 'wsl',
      remote?.rateLimits
    )
  }
  const selection = local.settings?.activeClaudeManagedAccountIdsByRuntime
  const activeId = place.distro
    ? (selection?.wsl[place.distro] ?? null)
    : (selection?.host ?? local.settings?.activeClaudeManagedAccountId ?? null)
  const target = local.rateLimits.claudeTarget
  const runtimeMatches = place.distro
    ? target.runtime === 'wsl' && target.wslDistro === place.distro
    : target.runtime === 'host'
  return readUsage(account.id, activeId, runtimeMatches, local.rateLimits)
}

/** The hover's usage plus a refresh to call when the hover opens. */
export function useForkClaudeAccountUsage(account: ForkClaudeAccount | null): {
  limits: ProviderRateLimits | null
  isFetching: boolean
  refresh: () => void
} {
  const rateLimits = useAppStore((state) => state.rateLimits)
  const settings = useAppStore((state) => state.settings)
  const fetchInactive = useAppStore((state) => state.fetchInactiveClaudeAccountUsage)
  const cacheVersion = useSyncExternalStore(subscribeClaudeChipCache, getClaudeChipCacheVersion)
  const place = account ? ownerPlace(account.ownerKey) : null
  const remote =
    place?.kind === 'remote'
      ? recomputeOn([cacheVersion], () => getClaudeHostSnapshot(place.target))
      : undefined
  const limits = account ? accountUsage(account, { rateLimits, settings }, remote) : null
  const inactive =
    account && place?.kind === 'local'
      ? rateLimits.inactiveClaudeAccounts.find((entry) => entry.accountId === account.id)
      : undefined
  const ownerKey = account?.ownerKey
  const refresh = useCallback(() => {
    if (!ownerKey) {
      return
    }
    const next = ownerPlace(ownerKey)
    // Same reads the status bar's switcher makes when it opens.
    if (next.kind === 'remote') {
      void loadClaudeHost(next.target, true)
    } else {
      void fetchInactive()
    }
  }, [ownerKey, fetchInactive])
  return { limits, isFetching: inactive?.isFetching === true, refresh }
}
