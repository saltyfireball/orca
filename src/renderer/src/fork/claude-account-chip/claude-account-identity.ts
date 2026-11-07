// SLRM-1503: which Claude account a session runs on, as the account chip names it. Pure, so the
// rules for labels, colours and mixed worktrees are tested without a store.
import type {
  ClaudeManagedAccount,
  ClaudeRateLimitAccountsState
} from '../../../../shared/managed-account-types'
import { isClaudePaneOnAccount, resolveClaudePaneFolder } from '@/lib/claude-pane-account-folder'
import { signedInClaudeAccountCount } from '@/components/status-bar/status-bar-claude-accounts'
import { translate } from '@/i18n/i18n'

/** Account id the chip uses for System default, which has no saved account. */
export const SYSTEM_DEFAULT_ACCOUNT_ID = '__system-default__'

/** One host's Claude accounts, as the chip resolves sessions that run on that host. */
export type ClaudeOwnerAccounts = {
  /** Owner of the accounts: `local`, `local:wsl:<distro>` or `environment:<id>`. */
  ownerKey: string
  /** Shown after the label when the host is not this desktop; null for this desktop. */
  hostLabel: string | null
  /** Saved accounts the desktop manages for this owner; empty for a remote host. */
  saved: readonly ClaudeManagedAccount[]
  /** What the host reported about its folders and logins; undefined until it answers. */
  host: ClaudeRateLimitAccountsState | undefined
}

export type ForkClaudeAccount = {
  ownerKey: string
  /** Saved account id, or {@link SYSTEM_DEFAULT_ACCOUNT_ID}. */
  id: string
  email: string | null
  /** Short label such as `B` or `B @ kif`. */
  label: string
  colour: string
  hostLabel: string | null
}

export type ForkClaudeAccountResolution =
  /** Not a Claude session, or its host has one account or none: the chip draws nothing. */
  | { kind: 'none' }
  | { kind: 'unknown'; ownerKey: string; hostLabel: string | null }
  /** `movingTo` while a move to another account waits for the chat's turn to end. */
  | { kind: 'account'; account: ForkClaudeAccount; movingTo?: ForkClaudeAccount }
  | { kind: 'mixed'; accounts: ForkClaudeAccount[] }

export const NO_ACCOUNT: ForkClaudeAccountResolution = { kind: 'none' }

/** Orca keeps no colour per account, so each id gets a stable hue. */
export function accountColourForId(id: string): string {
  // FNV-1a: cheap and stable across runs and machines.
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `hsl(${hash % 360} 62% 56%)`
}

type Identity = { id: string; email: string | null }

function ownerIdentities(owner: ClaudeOwnerAccounts): Identity[] {
  const byId = new Map<string, Identity>()
  for (const account of owner.saved) {
    byId.set(account.id, { id: account.id, email: account.email })
  }
  for (const account of owner.host?.accounts ?? []) {
    byId.set(account.id, { id: account.id, email: account.email })
  }
  const identities = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
  identities.push({
    id: SYSTEM_DEFAULT_ACCOUNT_ID,
    email: owner.host?.systemDefaultEmail ?? null
  })
  return identities
}

function localPart(email: string | null): string {
  return (email ?? '').split('@')[0]?.trim() ?? ''
}

/** The shortest email prefix that no other account on the owner shares, capitalised. */
function shortLabel(identity: Identity, all: readonly Identity[]): string {
  const name = localPart(identity.email)
  if (!name) {
    return identity.id === SYSTEM_DEFAULT_ACCOUNT_ID
      ? translate('fork.accountChip.systemDefaultShort', 'Default')
      : '?'
  }
  const others = all
    .filter((other) => other.id !== identity.id)
    .map((other) => localPart(other.email).toLowerCase())
  let length = 1
  while (
    length < name.length &&
    others.some((other) => other.startsWith(name.slice(0, length).toLowerCase()))
  ) {
    length += 1
  }
  const prefix = name.slice(0, Math.min(length, 6))
  return prefix.charAt(0).toUpperCase() + prefix.slice(1)
}

function toAccount(owner: ClaudeOwnerAccounts, identity: Identity): ForkClaudeAccount {
  const label = shortLabel(identity, ownerIdentities(owner))
  return {
    ownerKey: owner.ownerKey,
    id: identity.id,
    email: identity.email,
    label: owner.hostLabel ? `${label} @ ${owner.hostLabel}` : label,
    colour: accountColourForId(identity.id),
    hostLabel: owner.hostLabel
  }
}

/** Accounts a session on this owner could run on; the chip hides itself at one or none. */
export function ownerAccountCount(owner: ClaudeOwnerAccounts): number {
  if (owner.host) {
    // Remote and host-scope counts come from what the host reported, as the status bar counts.
    return Math.max(signedInClaudeAccountCount(owner.host), owner.saved.length)
  }
  // Before the host answers, System default plus each saved account is the best guess.
  return owner.saved.length + 1
}

/** A session's account from the folder its Claude keeps its config in. */
export function resolveAccountFromConfigPath(
  owner: ClaudeOwnerAccounts,
  transcriptOrHome: {
    transcriptPath?: string
    home?: string
    accountId?: string | null
  }
): ForkClaudeAccountResolution {
  if (ownerAccountCount(owner) <= 1) {
    return NO_ACCOUNT
  }
  const identities = ownerIdentities(owner)
  const named = transcriptOrHome.accountId
    ? identities.find((identity) => identity.id === transcriptOrHome.accountId)
    : undefined
  if (named) {
    return { kind: 'account', account: toAccount(owner, named) }
  }
  // A home is the folder a transcript sits under, so both go through the one matcher. The
  // matcher drops a trailing slash, so the stand-in transcript needs a name after `projects/`.
  const path =
    transcriptOrHome.transcriptPath ??
    (transcriptOrHome.home
      ? `${transcriptOrHome.home.replace(/[\\/]+$/, '')}/projects/chat`
      : undefined)
  const folder = resolveClaudePaneFolder(path, owner.saved, owner.host)
  const unknown: ForkClaudeAccountResolution = {
    kind: 'unknown',
    ownerKey: owner.ownerKey,
    hostLabel: owner.hostLabel
  }
  if (folder?.kind === 'account') {
    const identity = identities.find((candidate) => candidate.id === folder.accountId)
    return identity ? { kind: 'account', account: toAccount(owner, identity) } : unknown
  }
  if (folder?.kind !== 'system-default') {
    return unknown
  }
  // System default signed in to a saved account's own login is that account.
  const same = identities.find(
    (identity) =>
      identity.id !== SYSTEM_DEFAULT_ACCOUNT_ID &&
      isClaudePaneOnAccount(folder, identity.id, owner.host)
  )
  const identity =
    same ?? identities.find((candidate) => candidate.id === SYSTEM_DEFAULT_ACCOUNT_ID)
  return identity ? { kind: 'account', account: toAccount(owner, identity) } : unknown
}

/** One chip for many sessions: a single account, `mixed`, or unknown when none is known. */
export function combineResolutions(
  resolutions: readonly ForkClaudeAccountResolution[]
): ForkClaudeAccountResolution {
  const known = resolutions.filter((resolution) => resolution.kind !== 'none')
  if (known.length === 1) {
    // One session keeps its own resolution, a move waiting on its turn included.
    return known[0]
  }
  const accounts = new Map<string, ForkClaudeAccount>()
  let unknown: ForkClaudeAccountResolution | null = null
  for (const resolution of resolutions) {
    if (resolution.kind === 'account') {
      // The same account id on two hosts is two logins, so the key carries the owner.
      accounts.set(`${resolution.account.ownerKey}|${resolution.account.id}`, resolution.account)
    } else if (resolution.kind === 'mixed') {
      for (const account of resolution.accounts) {
        accounts.set(`${account.ownerKey}|${account.id}`, account)
      }
    } else if (resolution.kind === 'unknown') {
      unknown ??= resolution
    }
  }
  const list = [...accounts.values()]
  if (list.length > 1) {
    return { kind: 'mixed', accounts: list }
  }
  if (list.length === 1) {
    return { kind: 'account', account: list[0] }
  }
  return unknown ?? NO_ACCOUNT
}
