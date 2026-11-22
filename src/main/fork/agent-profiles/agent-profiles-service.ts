// FORK.md "Agent profiles": reads this host's settings for the profile RPCs.
import {
  forkAgentProfileMaxPermission,
  forkAgentProfileNeedsConfirm,
  resolveForkAgentProfile,
  type ForkAgentProfileExplicit,
  type ForkAgentProfileResolution
} from '../../../shared/fork/agent-profiles/agent-profiles-resolve'
import { normalizeForkAgentProfiles } from '../../../shared/fork/agent-profiles/agent-profiles-normalize'
import type { ForkAgentProfileRow } from '../../../shared/fork/agent-profiles/agent-profiles-wire'

type Settings = object

export function forkAgentProfileListRows(settings: Settings): ForkAgentProfileRow[] {
  const saved = (settings as { forkAgentProfiles?: unknown }).forkAgentProfiles
  return normalizeForkAgentProfiles(saved).map((profile) => ({
    ...profile,
    needsConfirm: forkAgentProfileNeedsConfirm(profile),
    maxPermission: forkAgentProfileMaxPermission(settings, profile.agent)
  }))
}

export function forkAgentProfileResolve(
  settings: Settings,
  name: string,
  explicit: ForkAgentProfileExplicit & { createsWorktree?: boolean }
): ForkAgentProfileResolution {
  const { createsWorktree, ...flags } = explicit
  return resolveForkAgentProfile({
    settings,
    name,
    explicit: flags,
    createsWorktree
  })
}
