// FORK.md "Agent profiles": reads this host's settings for the profile RPCs.
import {
  forkAgentProfileMaxPermission,
  forkAgentProfileNeedsConfirm,
  resolveForkAgentProfile,
  type ForkAgentProfileExplicit,
  type ForkAgentProfileResolution,
  type ForkAgentProfileResolved
} from '../../../shared/fork/agent-profiles/agent-profiles-resolve'
import { normalizeForkAgentProfiles } from '../../../shared/fork/agent-profiles/agent-profiles-normalize'
import type {
  ForkAgentProfileLaunchSummary,
  ForkAgentProfileRow
} from '../../../shared/fork/agent-profiles/agent-profiles-wire'
import { forkProfilePermissionSurfaces } from '../../../shared/fork/agent-profiles/agent-profile-launch'
import { getClaudeProfileRouter } from '../../claude-accounts/profiles/routing/claude-profile-installed-router'
import {
  resolveForkProfileAccount,
  type ForkAgentProfileHostSettings,
  type ForkProfileAccountRouter
} from './agent-profile-account'

type Settings = ForkAgentProfileHostSettings

export function forkAgentProfileListRows(settings: Settings): ForkAgentProfileRow[] {
  return normalizeForkAgentProfiles(settings.forkAgentProfiles).map((profile) => ({
    ...profile,
    needsConfirm: forkAgentProfileNeedsConfirm(profile),
    maxPermission: forkAgentProfileMaxPermission(settings, profile.agent)
  }))
}

export function forkAgentProfileResolve(
  settings: Settings,
  name: string,
  explicit: ForkAgentProfileExplicit & { createsWorktree?: boolean; remote?: boolean }
): ForkAgentProfileResolution {
  const { createsWorktree, remote: _remote, ...flags } = explicit
  return resolveForkAgentProfile({
    settings,
    name,
    explicit: flags,
    createsWorktree
  })
}

/**
 * BAD-741: what a launch of `resolved` applies on this host. An account this host lacks or has
 * signed out refuses, so the CLI stops before anything is created; the launch checks it again.
 */
export function forkAgentProfileLaunchSummary(
  settings: Settings,
  resolved: ForkAgentProfileResolved,
  remote: boolean,
  router: ForkProfileAccountRouter | undefined = getClaudeProfileRouter()
): { ok: true; summary: ForkAgentProfileLaunchSummary } | { ok: false; message: string } {
  const lines: string[] = []
  const notes: string[] = []
  const { agent, permissionMode: mode, account } = resolved
  if (mode) {
    const surfaces = forkProfilePermissionSurfaces(agent, mode)
    lines.push(`profile permission: ${mode}`)
    if (!surfaces.terminal) {
      notes.push(
        `${agent} terminals have no ${mode} permission mode, so a terminal start runs on its Settings permission.`
      )
    }
    if (!surfaces.chat) {
      notes.push(
        `${agent} chats have no ${mode} permission mode, so a chat start runs on its Settings permission.`
      )
    }
  }
  if (account && remote) {
    lines.push(`profile account: ${account} (the server that runs it checks it)`)
  } else if (account) {
    const checked = resolveForkProfileAccount(agent, account, settings, router)
    if (!checked.ok) {
      return checked
    }
    const { plan } = checked
    if (plan.kind === 'not-applied') {
      notes.push(plan.note)
    } else {
      lines.push(`profile account: ${plan.label}`)
    }
  }
  return { ok: true, summary: { lines, notes } }
}
