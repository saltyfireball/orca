// FORK.md "Agent profiles": a named launch bundle (agent, model, effort, permission mode, MCP
// profile, account, preamble) with a note on when to use it. Shared by main, the CLI and settings.
import type { AgentChatPermissionMode } from '../../agent-launch/permissions/agent-chat-permission-mode'

export const FORK_AGENT_PROFILE_PERMISSION_MODES = [
  'ask',
  'accept-edits',
  'auto',
  'full-access'
] as const satisfies readonly AgentChatPermissionMode[]

export type ForkAgentProfilePermissionMode = (typeof FORK_AGENT_PROFILE_PERMISSION_MODES)[number]

/** Where an imported profile came from; an imported preamble must be confirmed before first use. */
export type ForkAgentProfileImport = {
  /** The definition file it was read from, as given at import. */
  path: string
  /** Hash of the preamble the user confirmed; unset means not confirmed yet. */
  confirmedHash?: string
}

export type ForkAgentProfile = {
  /** The name `--profile` and the catalog use: letters, digits, dot, dash, underscore. */
  name: string
  agent: string
  model?: string
  effort?: string
  permissionMode?: ForkAgentProfilePermissionMode
  /** A name from Settings > Blackfish > MCP profiles (Claude only). */
  mcpProfile?: string
  /** An account id, email or label from `orca account list`. Recorded and shown; see FORK.md. */
  account?: string
  /** Text put in front of the launch prompt or worker spec. */
  preamble?: string
  /** When a coordinator should pick this profile. */
  whenToUse?: string
  imported?: ForkAgentProfileImport
}

export type ForkAgentProfileSettings = {
  /** Fork agent profiles: the user's named launch bundles; unset is none. */
  forkAgentProfiles?: ForkAgentProfile[]
  /** Fork agent profiles: the widest permission mode a profile may ask for when Settings > Agents sets none for its agent; unset is 'accept-edits'. */
  forkAgentProfilePermissionCap?: ForkAgentProfilePermissionMode
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function isForkAgentProfileName(value: unknown): value is string {
  return typeof value === 'string' && NAME.test(value)
}

export const FORK_AGENT_PROFILE_PARAM = 'forkAgentProfile'
