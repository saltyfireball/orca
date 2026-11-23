// FORK.md "Agent profiles" (BAD-741): the profile's account on the host that runs the launch. A
// Claude launch takes it through the account pin (SLRM-1503): a pane marker for a terminal, a
// session pin for a chat. Codex has no per-launch account in Orca, so only its selected account
// counts. Reads account records and login metadata through the router, never credentials.
import { FORK_CLAUDE_SYSTEM_DEFAULT } from '../../../shared/fork/claude-account-move'
import { normalizeCodexRuntimeSelection } from '../../codex-accounts/account-management/runtime-selection'
import type { GlobalSettings } from '../../../shared/settings/global-settings-types'
import type { PinnedClaudeRouter } from '../claude-account-move/claude-pinned-route'
import type { ForkAgentProfilePolicySettings } from '../../../shared/fork/agent-profiles/agent-profiles-resolve'

type NamedAccount = {
  id: string
  email: string
  managedAuthRuntime?: string
  managedHomeRuntime?: string
}

export type ForkProfileAccountSettings = Partial<
  Pick<GlobalSettings, 'activeCodexManagedAccountId' | 'activeCodexManagedAccountIdsByRuntime'>
> & {
  claudeManagedAccounts?: readonly NamedAccount[]
  codexManagedAccounts?: readonly NamedAccount[]
  managedAccountDisplayNames?: Partial<Record<'claude' | 'codex', Record<string, string>>>
}

/** What a launch host reads to resolve a profile: the list, the permission policy and accounts. */
export type ForkAgentProfileHostSettings = ForkProfileAccountSettings &
  ForkAgentProfilePolicySettings & { forkAgentProfiles?: unknown }

export type ForkProfileAccountRouter = Pick<PinnedClaudeRouter, 'coveredBySystemDefault'> & {
  accountLogin(accountId: string): unknown
}

export type ForkProfileAccountPlan =
  /** `pin` is the account id, or null for System default. */
  | { kind: 'claude'; pin: string | null; label: string }
  | { kind: 'codex-selected'; label: string }
  | { kind: 'not-applied'; label: string; note: string }

export type ForkProfileAccountResult =
  | { ok: true; plan: ForkProfileAccountPlan }
  | { ok: false; message: string }

const CLAUDE_AGENTS = new Set(['claude', 'claude-agent-teams'])

function hostAccounts(accounts: readonly NamedAccount[] | undefined): NamedAccount[] {
  return (accounts ?? []).filter(
    (account) => account.managedAuthRuntime !== 'wsl' && account.managedHomeRuntime !== 'wsl'
  )
}

function find(
  provider: 'claude' | 'codex',
  accounts: NamedAccount[],
  names: Record<string, string> | undefined,
  query: string
): { account: NamedAccount; label: string } | { message: string } | null {
  const label = (account: NamedAccount): string => names?.[account.id]?.trim() || account.email
  const byId = accounts.find((account) => account.id === query)
  if (byId) {
    return { account: byId, label: label(byId) }
  }
  const needle = query.toLowerCase()
  const matches = accounts.filter(
    (account) =>
      account.email.toLowerCase() === needle || names?.[account.id]?.trim().toLowerCase() === needle
  )
  if (matches.length > 1) {
    return {
      message: `Several ${provider === 'claude' ? 'Claude' : 'Codex'} accounts on this computer match "${query}"; put one of their ids in the profile: ${matches.map((account) => account.id).join(', ')}.`
    }
  }
  return matches[0] ? { account: matches[0], label: label(matches[0]) } : null
}

const missing = (provider: string, query: string): ForkProfileAccountResult => ({
  ok: false,
  message: `The profile's ${provider} account "${query}" does not exist on this computer. See \`orca account list --agent ${provider.toLowerCase()}\`, or change the profile's account. Nothing was started.`
})

/** Refuses an account this host lacks or has signed out, before anything is created. */
export function resolveForkProfileAccount(
  agent: string,
  query: string,
  settings: ForkProfileAccountSettings,
  router: ForkProfileAccountRouter | undefined
): ForkProfileAccountResult {
  if (CLAUDE_AGENTS.has(agent)) {
    if (query.toLowerCase() === FORK_CLAUDE_SYSTEM_DEFAULT) {
      return { ok: true, plan: { kind: 'claude', pin: null, label: 'System default' } }
    }
    const found = router
      ? find(
          'claude',
          hostAccounts(settings.claudeManagedAccounts),
          settings.managedAccountDisplayNames?.claude,
          query
        )
      : null
    if (!found) {
      return missing('Claude', query)
    }
    if ('message' in found) {
      return { ok: false, message: found.message }
    }
    const { account, label } = found
    if (!router?.accountLogin(account.id) && !router?.coveredBySystemDefault(account.id)) {
      return {
        ok: false,
        message: `The profile's Claude account "${label}" is signed out on this computer. Sign in to it again (Settings > Accounts, or \`orca account add --agent claude\`), or change the profile's account. Nothing was started.`
      }
    }
    return { ok: true, plan: { kind: 'claude', pin: account.id, label } }
  }
  if (agent === 'codex') {
    const selected = normalizeCodexRuntimeSelection(settings).host
    const system = query.toLowerCase() === FORK_CLAUDE_SYSTEM_DEFAULT
    const found = system
      ? null
      : find(
          'codex',
          hostAccounts(settings.codexManagedAccounts),
          settings.managedAccountDisplayNames?.codex,
          query
        )
    if (!system && !found) {
      return missing('Codex', query)
    }
    if (found && 'message' in found) {
      return { ok: false, message: found.message }
    }
    const id = found ? found.account.id : null
    const label = found ? found.label : 'System default'
    if (id === selected) {
      return { ok: true, plan: { kind: 'codex-selected', label } }
    }
    return {
      ok: true,
      plan: {
        kind: 'not-applied',
        label,
        note: `Codex runs on the account selected on this computer, and a launch cannot choose its own, so the profile's account ${label} is not used. Select it with \`orca account select --agent codex --account ${id ?? FORK_CLAUDE_SYSTEM_DEFAULT}\` to run on it.`
      }
    }
  }
  return {
    ok: true,
    plan: {
      kind: 'not-applied',
      label: query,
      note: `${agent} has no account Orca can choose, so the profile's account ${query} is not used.`
    }
  }
}
