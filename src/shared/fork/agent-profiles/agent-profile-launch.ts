// FORK.md "Agent profiles" (BAD-741): what a `--profile` launch applies on the host that runs the
// agent, beyond the flags the CLI rewrites: the permission mode, the account and the preamble.
// Shared by the CLI (what it prints), the host (what it applies) and a paired server (what travels).
import { z } from 'zod'
import { agentChatPermissionModes } from '../../agent-launch/permissions/agent-chat-permission-support'
import { agentPermissionHasTerminalChoice } from '../../agent-launch/permissions/tui-agent-permission-choice'
import { isTuiAgent } from '../../agent-launch/catalog/tui-agent-config'
import {
  FORK_AGENT_PROFILE_PERMISSION_MODES,
  type ForkAgentProfilePermissionMode
} from './agent-profiles-types'

/** The raw request field a home sends a paired server: the profile as the home resolved it. */
export const FORK_AGENT_PROFILE_LAUNCH_PARAM = 'forkAgentProfileLaunch'

export const ForkAgentProfileLaunchWire = z.object({
  name: z.string().min(1).max(64),
  agent: z.string().min(1).max(64),
  permissionMode: z.enum(FORK_AGENT_PROFILE_PERMISSION_MODES).optional(),
  account: z.string().min(1).max(200).optional(),
  preamble: z.string().min(1).max(20_000).optional()
})

export type ForkAgentProfileLaunchWire = z.infer<typeof ForkAgentProfileLaunchWire>

/** Where an agent can take a permission mode: its terminal flags, its chat's session option. */
export function forkProfilePermissionSurfaces(
  agent: string,
  mode: ForkAgentProfilePermissionMode
): { terminal: boolean; chat: boolean } {
  return {
    terminal: isTuiAgent(agent) && agentPermissionHasTerminalChoice(agent, mode),
    chat: agentChatPermissionModes(agent)?.modes.includes(mode) === true
  }
}

/** The task text with the preamble in front, once: a spec that already holds it is left as it is. */
export function withForkProfilePreamble(spec: string, preamble: string | undefined): string {
  const text = preamble?.trim()
  if (!text || spec.includes(text)) {
    return spec
  }
  return spec.trim() ? `${text}\n\n${spec}` : text
}

/** The bot preamble's one line about profiles. */
export const forkAgentProfileToolLine = (cli: string): string =>
  `- Saved agent profiles (agent, model, permission, account, preamble): \`${cli} profiles list\`; when one fits a worker's job, add \`--profile <name>\` to its start.`
