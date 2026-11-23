// The fork.agentProfiles.* RPC contract between `orca profiles`, the launch commands and the host.
import { z } from 'zod'
import type { ForkAgentProfile } from './agent-profiles-types'
import type { ForkAgentProfileResolved } from './agent-profiles-resolve'

export const ForkAgentProfilesListParams = z.object({})

export const ForkAgentProfileResolveParams = z.object({
  name: z.string().min(1).max(64),
  agent: z.string().max(64).optional(),
  model: z.string().max(200).optional(),
  effort: z.string().max(64).optional(),
  mcpProfile: z.string().max(64).optional(),
  permissionMode: z.string().max(32).optional(),
  createsWorktree: z.boolean().optional(),
  /** BAD-741: the launch runs on a paired server, which checks the account itself. */
  remote: z.boolean().optional()
})

export type ForkAgentProfileRow = ForkAgentProfile & {
  /** True for an imported profile whose preamble the user has not confirmed. */
  needsConfirm: boolean
  /** The widest permission mode this profile may use on its agent, from Settings. */
  maxPermission: string
}

export type ForkAgentProfilesListResult = { profiles: ForkAgentProfileRow[] }

/** BAD-741: what the launch applies on this host, as lines the CLI prints. */
export type ForkAgentProfileLaunchSummary = { lines: string[]; notes: string[] }

export type ForkAgentProfileResolveResult = {
  resolved: ForkAgentProfileResolved
  /** Absent from a host older than BAD-741, which applies no permission mode or account. */
  launch?: ForkAgentProfileLaunchSummary
}
