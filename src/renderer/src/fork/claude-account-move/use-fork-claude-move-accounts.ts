// SLRM-1503: the Claude accounts a move can pick, read from the host that runs the chats, with each
// account's 5h and weekly usage. A chat moves only to an account saved on its own host.
import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import {
  fetchProviderAccountsSnapshot,
  getProviderAccountsOwnerKey,
  type ProviderAccountsSnapshot
} from '@/runtime/runtime-provider-accounts-client'
import type { ClaudeRateLimitAccountsState } from '../../../../shared/managed-account-types'
import type {
  ProviderRateLimits,
  RateLimitState,
  RateLimitWindow
} from '../../../../shared/rate-limit-types'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { readClaudeChatAccounts, type ForkClaudeMoveScope } from './claude-account-move-client'

export type ForkClaudeMoveAccountChoice = {
  /** Null is System default. */
  id: string | null
  label: string
  session: RateLimitWindow | null
  weekly: RateLimitWindow | null
}

function usageOf(
  id: string | null,
  activeId: string | null,
  rateLimits: RateLimitState | null
): ProviderRateLimits | null {
  if (!rateLimits) {
    return null
  }
  if (id === activeId) {
    return rateLimits.claudeTarget.runtime === 'host' ? rateLimits.claude : null
  }
  return id === null
    ? null
    : (rateLimits.inactiveClaudeAccounts.find((entry) => entry.accountId === id)?.rateLimits ??
        null)
}

/** System default first, then the host's own (not WSL) saved accounts. */
export function moveAccountChoices(
  claude: ClaudeRateLimitAccountsState,
  rateLimits: RateLimitState | null
): ForkClaudeMoveAccountChoice[] {
  const byRuntime = claude.activeAccountIdsByRuntime
  const activeId = byRuntime ? byRuntime.host : claude.activeAccountId
  const choice = (id: string | null, label: string): ForkClaudeMoveAccountChoice => {
    const usage = usageOf(id, activeId, rateLimits)
    return { id, label, session: usage?.session ?? null, weekly: usage?.weekly ?? null }
  }
  return [
    choice(null, translate('fork.accountMove.systemDefault', 'System default')),
    ...claude.accounts
      .filter((account) => account.managedAuthRuntime !== 'wsl')
      .map((account) => choice(account.id, account.email))
  ]
}

export function usageText(choice: ForkClaudeMoveAccountChoice): string {
  const part = (label: string, window: RateLimitWindow | null) =>
    window ? `${label} ${Math.round(window.usedPercent)}%` : null
  const parts = [
    part(translate('fork.accountMove.fiveHour', '5h'), choice.session),
    part(translate('fork.accountMove.weekly', 'week'), choice.weekly)
  ].filter((entry): entry is string => entry !== null)
  return parts.length > 0
    ? parts.join(' / ')
    : translate('fork.accountMove.noUsage', 'no usage yet')
}

function scopeKey(scope: ForkClaudeMoveScope | undefined): string {
  if (!scope) {
    return ''
  }
  return 'sessionId' in scope ? `s:${scope.sessionId}` : `w:${scope.worktreeId}`
}

/**
 * Reads the host's accounts while `open`. `currentAccountId` is the account a single chat runs
 * on next (undefined until known, or for a worktree).
 */
export function useForkClaudeMoveAccounts(
  target: RuntimeClientTarget | null,
  open: boolean,
  scope?: ForkClaudeMoveScope
): {
  choices: ForkClaudeMoveAccountChoice[] | null
  currentAccountId: string | null | undefined
  failed: boolean
} {
  const [snapshot, setSnapshot] = useState<ProviderAccountsSnapshot | null>(null)
  const [currentAccountId, setCurrent] = useState<string | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const localRateLimits = useAppStore((state) => state.rateLimits)
  const fetchInactive = useAppStore((state) => state.fetchInactiveClaudeAccountUsage)
  const ownerKey = target ? getProviderAccountsOwnerKey(target) : null
  const scopeId = scopeKey(scope)

  useEffect(() => {
    if (!open || !target) {
      return
    }
    let live = true
    setFailed(false)
    setSnapshot(null)
    setCurrent(undefined)
    fetchProviderAccountsSnapshot(target).then(
      (next) => live && setSnapshot(next),
      () => live && setFailed(true)
    )
    if (target.kind === 'local') {
      void fetchInactive()
    }
    if (scope && 'sessionId' in scope) {
      readClaudeChatAccounts(target, scope).then(
        (reply) => live && setCurrent(reply.sessions[0]?.accountId),
        () => live && setCurrent(undefined)
      )
    }
    return () => {
      live = false
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- Why: ownerKey and scopeId name target and scope, which callers rebuild each render.
  }, [open, ownerKey, scopeId, fetchInactive])

  const isLocal = target?.kind === 'local'
  const choices = useMemo(
    () =>
      snapshot
        ? moveAccountChoices(snapshot.claude, isLocal ? localRateLimits : snapshot.rateLimits)
        : null,
    [snapshot, isLocal, localRateLimits]
  )
  return { choices, currentAccountId, failed }
}
