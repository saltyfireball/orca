// Reads saved profiles defensively: a hand-edited settings file may hold anything.
import {
  FORK_AGENT_PROFILE_PERMISSION_MODES,
  isForkAgentProfileName,
  type ForkAgentProfile,
  type ForkAgentProfilePermissionMode
} from './agent-profiles-types'

const MAX_PREAMBLE = 20_000
const MAX_NOTE = 1_000

function text(value: unknown, max = 200): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
}

/** A hand-edited list Orca cannot read still says something was not kept: fail closed. */
function notKeptList(value: unknown): string[] {
  if (value === undefined) {
    return []
  }
  const lines = Array.isArray(value) ? value.map((entry) => text(entry, 300)) : []
  if (!Array.isArray(value) || lines.some((entry) => !entry)) {
    return ['the list of limits not kept is not readable']
  }
  return (lines as string[]).slice(0, 50)
}

export function normalizeForkAgentProfile(value: unknown): ForkAgentProfile | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw = value as Record<string, unknown>
  const name = text(raw.name, 64)
  const agent = text(raw.agent, 64)
  if (!name || !isForkAgentProfileName(name) || !agent) {
    return null
  }
  const mode = FORK_AGENT_PROFILE_PERMISSION_MODES.find((entry) => entry === raw.permissionMode)
  const imported =
    raw.imported && typeof raw.imported === 'object'
      ? (raw.imported as Record<string, unknown>)
      : undefined
  const importPath = text(imported?.path, 500)
  const confirmedHash = text(imported?.confirmedHash, 128)
  const notKept = notKeptList(imported?.notKept)
  return {
    name,
    agent,
    ...(text(raw.model) ? { model: text(raw.model) } : {}),
    ...(text(raw.effort) ? { effort: text(raw.effort) } : {}),
    ...(mode ? { permissionMode: mode } : {}),
    ...(text(raw.mcpProfile) ? { mcpProfile: text(raw.mcpProfile) } : {}),
    ...(text(raw.account) ? { account: text(raw.account) } : {}),
    ...(text(raw.preamble, MAX_PREAMBLE) ? { preamble: text(raw.preamble, MAX_PREAMBLE) } : {}),
    ...(text(raw.whenToUse, MAX_NOTE) ? { whenToUse: text(raw.whenToUse, MAX_NOTE) } : {}),
    ...(importPath
      ? {
          imported: {
            path: importPath,
            ...(confirmedHash ? { confirmedHash } : {}),
            ...(notKept.length > 0 ? { notKept } : {})
          }
        }
      : {})
  }
}

/** The valid profiles, in order, the first of a repeated name only. */
export function normalizeForkAgentProfiles(value: unknown): ForkAgentProfile[] {
  if (!Array.isArray(value)) {
    return []
  }
  const seen = new Set<string>()
  const out: ForkAgentProfile[] = []
  for (const entry of value) {
    const profile = normalizeForkAgentProfile(entry)
    if (profile && !seen.has(profile.name)) {
      seen.add(profile.name)
      out.push(profile)
    }
  }
  return out
}

export function forkAgentProfileCap(value: unknown): ForkAgentProfilePermissionMode {
  return FORK_AGENT_PROFILE_PERMISSION_MODES.find((entry) => entry === value) ?? 'accept-edits'
}
