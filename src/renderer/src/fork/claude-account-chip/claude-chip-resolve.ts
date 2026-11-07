// SLRM-1503: a session's account, resolved against the host that runs it, never this desktop's.
import type { ClaudeManagedAccount } from '../../../../shared/managed-account-types'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import {
  NO_ACCOUNT,
  SYSTEM_DEFAULT_ACCOUNT_ID,
  combineResolutions,
  ownerAccountCount,
  resolveAccountFromConfigPath,
  type ClaudeOwnerAccounts,
  type ForkClaudeAccountResolution
} from './claude-account-identity'
import type { ClaudeChipEvidence } from './claude-chip-evidence'
import { transportKey, type ChatHomeEntry, type ClaudeHostSnapshot } from './claude-chip-host-cache'

export type ClaudeChipLookups = {
  host: (target: RuntimeClientTarget) => ClaudeHostSnapshot | undefined
  chatHome: (target: RuntimeClientTarget, sessionId: string) => ChatHomeEntry
}

export function ownerKeyFor(
  evidence: Pick<ClaudeChipEvidence, 'ownerTarget' | 'wslHostDistro'>
): string {
  return evidence.wslHostDistro
    ? `local:wsl:${evidence.wslHostDistro}`
    : transportKey(evidence.ownerTarget)
}

/** The owner's accounts: saved ones this desktop manages for it, plus what its host reported. */
export function ownerAccountsFor(
  evidence: ClaudeChipEvidence,
  saved: readonly ClaudeManagedAccount[],
  lookups: Pick<ClaudeChipLookups, 'host'>
): ClaudeOwnerAccounts {
  const distro = evidence.wslHostDistro
  const remote = evidence.ownerTarget.kind === 'environment'
  return {
    ownerKey: ownerKeyFor(evidence),
    hostLabel: evidence.hostLabel,
    // A remote host keeps its own accounts; desktop settings never describe them.
    saved: remote
      ? []
      : saved.filter((account) =>
          distro
            ? account.managedAuthRuntime === 'wsl' && account.wslDistro === distro
            : (account.managedAuthRuntime ?? 'host') === 'host'
        ),
    // Main never reads a WSL guest's folders, so a distro has only its saved accounts.
    host: distro ? undefined : lookups.host(evidence.ownerTarget)?.claude
  }
}

export function resolveEvidence(
  evidence: ClaudeChipEvidence,
  saved: readonly ClaudeManagedAccount[],
  lookups: ClaudeChipLookups
): ForkClaudeAccountResolution {
  const owner = ownerAccountsFor(evidence, saved, lookups)
  if (evidence.chatSessionId === undefined) {
    return resolveAccountFromConfigPath(owner, {
      transcriptPath: evidence.transcriptPath
    })
  }
  const home = lookups.chatHome(evidence.transport, evidence.chatSessionId)
  if (home === 'loading' || (home !== 'failed' && home.home === null && home.pin === undefined)) {
    return NO_ACCOUNT
  }
  if (home === 'failed') {
    return ownerAccountCount(owner) > 1
      ? {
          kind: 'unknown',
          ownerKey: owner.ownerKey,
          hostLabel: owner.hostLabel
        }
      : NO_ACCOUNT
  }
  const launched = resolveAccountFromConfigPath(owner, {
    home: home.home ?? undefined,
    accountId: home.accountId
  })
  if (home.pin === undefined) {
    return launched
  }
  // A moved chat names its pin at once, before it relaunches there.
  const pinned = resolveAccountFromConfigPath(owner, {
    accountId: home.pin ?? SYSTEM_DEFAULT_ACCOUNT_ID
  })
  if (
    home.pending &&
    launched.kind === 'account' &&
    pinned.kind === 'account' &&
    launched.account.id !== pinned.account.id
  ) {
    return { kind: 'account', account: launched.account, movingTo: pinned.account }
  }
  return pinned.kind === 'account' ? pinned : launched
}

export function resolveAllEvidence(
  evidence: readonly ClaudeChipEvidence[],
  saved: readonly ClaudeManagedAccount[],
  lookups: ClaudeChipLookups
): ForkClaudeAccountResolution {
  return combineResolutions(evidence.map((entry) => resolveEvidence(entry, saved, lookups)))
}
