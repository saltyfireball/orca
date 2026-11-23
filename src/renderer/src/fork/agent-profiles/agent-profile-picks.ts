// FORK.md "Agent profiles" (BAD-741): what a profile picked in the new-chat menu or the automation
// dialog becomes. The same cap as a CLI launch: the mode is lowered to what Settings allow.
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import { isTuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent-config'
import type { AgentPickerDraft } from '../../../../shared/agent-launch/picker/agent-launch-picker'
import { normalizeForkAgentProfiles } from '../../../../shared/fork/agent-profiles/agent-profiles-normalize'
import {
  forkAgentProfileMaxPermission,
  forkAgentProfileNeedsConfirm,
  forkAgentProfilePermissionRank as rank,
  type ForkAgentProfilePolicySettings
} from '../../../../shared/fork/agent-profiles/agent-profiles-resolve'
import type {
  ForkAgentProfile,
  ForkAgentProfilePermissionMode
} from '../../../../shared/fork/agent-profiles/agent-profiles-types'
import { withForkProfilePreamble } from '../../../../shared/fork/agent-profiles/agent-profile-launch'

export type ForkAgentProfilePick = {
  profile: ForkAgentProfile & { agent: TuiAgent }
  /** The profile's mode after the Settings cap. */
  permissionMode?: ForkAgentProfilePermissionMode
  /** An imported preamble not yet confirmed with `orca profiles confirm`. */
  needsConfirm: boolean
  capped: boolean
}

export type ForkAgentProfilePickSettings = ForkAgentProfilePolicySettings & {
  forkAgentProfiles?: unknown
}

/** The profiles this computer offers, empty until the user makes or imports one. */
export function forkAgentProfilePicks(
  settings: ForkAgentProfilePickSettings | null | undefined
): ForkAgentProfilePick[] {
  return normalizeForkAgentProfiles(settings?.forkAgentProfiles).flatMap((profile) => {
    if (!isTuiAgent(profile.agent)) {
      return []
    }
    const max = forkAgentProfileMaxPermission(settings ?? {}, profile.agent)
    const wanted = profile.permissionMode
    const capped = wanted !== undefined && rank(wanted) > rank(max)
    return [
      {
        profile: { ...profile, agent: profile.agent },
        ...(wanted ? { permissionMode: capped ? max : wanted } : {}),
        needsConfirm: forkAgentProfileNeedsConfirm(profile),
        capped
      }
    ]
  })
}

/** The picker draft a new chat or terminal launches with: the profile's choices, and its
 *  preamble as the first prompt. */
export function forkAgentProfileLaunchDraft(
  pick: ForkAgentProfilePick,
  surface: 'chat' | 'terminal'
): AgentPickerDraft {
  const { model, effort, preamble } = pick.profile
  const choices = {
    ...(model ? { model } : {}),
    ...(effort ? { options: { effort } } : {}),
    ...(pick.permissionMode ? { permissionMode: pick.permissionMode } : {})
  }
  return {
    agent: pick.profile.agent,
    surface,
    choices,
    acceptedEdits: { choices },
    ...(preamble ? { prompt: preamble } : {})
  }
}

/** The automation prompt with the profile's preamble in front, once. */
export function forkAgentProfileAutomationPrompt(
  prompt: string,
  pick: ForkAgentProfilePick
): string {
  return withForkProfilePreamble(prompt, pick.profile.preamble)
}
