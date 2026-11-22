// Resolves `--profile <name>`: the profile's fields, then explicit flags over them, then the
// settings policy over the permission mode. Pure: the host passes its settings.
import type { TuiAgent } from '../../agent-launch/catalog/tui-agent'
import { isTuiAgent } from '../../agent-launch/catalog/tui-agent-config'
import { checkAgentLaunchModelPreferences } from '../../agent-launch/choices/agent-launch-model-preferences'
import { forkAgentProfileCap, normalizeForkAgentProfiles } from './agent-profiles-normalize'
import {
  FORK_AGENT_PROFILE_PERMISSION_MODES,
  type ForkAgentProfile,
  type ForkAgentProfilePermissionMode
} from './agent-profiles-types'

export type ForkAgentProfileExplicit = {
  agent?: string
  model?: string
  effort?: string
  mcpProfile?: string
  permissionMode?: string
}

export type ForkAgentProfileResolved = {
  name: string
  agent: TuiAgent
  model?: string
  effort?: string
  permissionMode?: ForkAgentProfilePermissionMode
  mcpProfile?: string
  account?: string
  preamble?: string
  whenToUse?: string
  /** Why a profile field was changed or not used. */
  notes: string[]
}

export type ForkAgentProfileResolution =
  | { ok: true; resolved: ForkAgentProfileResolved }
  | {
      ok: false
      code: 'unknown_profile' | 'profile_unconfirmed' | 'invalid_profile'
      message: string
    }

/** FNV-1a: tells an edited preamble from the one the user confirmed. Not a security boundary. */
export function forkAgentProfileHash(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function forkAgentProfileNeedsConfirm(profile: ForkAgentProfile): boolean {
  return (
    !!profile.imported &&
    !!profile.preamble &&
    profile.imported.confirmedHash !== forkAgentProfileHash(profile.preamble)
  )
}

type PolicySettings = {
  agentPermissionDefault?: string
  agentPermissionOverrides?: Record<string, string | undefined>
  forkAgentProfilePermissionCap?: unknown
}

function rank(mode: string): number {
  return (FORK_AGENT_PROFILE_PERMISSION_MODES as readonly string[]).indexOf(mode)
}

/** The widest mode a profile may use for an agent: Settings > Agents when it sets one, else the cap. */
export function forkAgentProfileMaxPermission(
  settings: PolicySettings,
  agent: string
): ForkAgentProfilePermissionMode {
  const policy = settings.agentPermissionOverrides?.[agent] ?? settings.agentPermissionDefault
  const fromPolicy = FORK_AGENT_PROFILE_PERMISSION_MODES.find((entry) => entry === policy)
  return fromPolicy ?? forkAgentProfileCap(settings.forkAgentProfilePermissionCap)
}

export function resolveForkAgentProfile(args: {
  settings: unknown
  name: string
  explicit?: ForkAgentProfileExplicit
  createsWorktree?: boolean
}): ForkAgentProfileResolution {
  const settings = (args.settings ?? {}) as PolicySettings & {
    forkAgentProfiles?: unknown
  }
  const profile = normalizeForkAgentProfiles(settings.forkAgentProfiles).find(
    (entry) => entry.name === args.name
  )
  if (!profile) {
    return {
      ok: false,
      code: 'unknown_profile',
      message: `Unknown agent profile "${args.name}". See \`orca profiles list\` for this host's profiles.`
    }
  }
  if (forkAgentProfileNeedsConfirm(profile)) {
    return {
      ok: false,
      code: 'profile_unconfirmed',
      message: `Profile "${profile.name}" was imported from ${profile.imported?.path} and its preamble has not been confirmed. Read it with \`orca profiles show ${profile.name}\`, then run \`orca profiles confirm ${profile.name}\`.`
    }
  }
  const explicit = args.explicit ?? {}
  const agentName = explicit.agent ?? profile.agent
  if (!isTuiAgent(agentName)) {
    return {
      ok: false,
      code: 'invalid_profile',
      message: `Profile "${profile.name}" names agent "${agentName}", which this Orca does not know.`
    }
  }
  const notes: string[] = []
  const sameAgent = agentName === profile.agent
  if (!sameAgent && (profile.model || profile.effort)) {
    notes.push(
      `--agent ${agentName} replaces the profile's agent, so its model and effort are not used.`
    )
  }
  const model = explicit.model ?? (sameAgent ? profile.model : undefined)
  const effort = explicit.effort ?? (sameAgent && !explicit.model ? profile.effort : undefined)
  const checked = checkAgentLaunchModelPreferences({
    agent: agentName,
    model,
    effort,
    createsWorktree: args.createsWorktree,
    openCodeModelLaunchSupported: true
  })
  let finalModel = model
  let finalEffort = effort
  if ('refusal' in checked) {
    if (explicit.model || explicit.effort) {
      return {
        ok: false,
        code: 'invalid_profile',
        message: checked.refusal.message
      }
    }
    notes.push(`The profile's model was not used: ${checked.refusal.message}`)
    finalModel = undefined
    finalEffort = undefined
  }
  const requested = explicit.permissionMode ?? profile.permissionMode
  const mode = FORK_AGENT_PROFILE_PERMISSION_MODES.find((entry) => entry === requested)
  let permissionMode = mode
  if (mode) {
    const max = forkAgentProfileMaxPermission(settings, agentName)
    if (rank(mode) > rank(max)) {
      permissionMode = max
      notes.push(
        `Permission mode ${mode} is wider than Settings allow for ${agentName}; using ${max}.`
      )
    }
  }
  const mcpProfile = explicit.mcpProfile ?? profile.mcpProfile
  return {
    ok: true,
    resolved: {
      name: profile.name,
      agent: agentName,
      ...(finalModel ? { model: finalModel } : {}),
      ...(finalEffort ? { effort: finalEffort } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      ...(mcpProfile ? { mcpProfile } : {}),
      ...(profile.account ? { account: profile.account } : {}),
      ...(profile.preamble ? { preamble: profile.preamble } : {}),
      ...(profile.whenToUse ? { whenToUse: profile.whenToUse } : {}),
      notes
    }
  }
}
