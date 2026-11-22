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
  createsWorktree: z.boolean().optional()
})

export type ForkAgentProfileRow = ForkAgentProfile & {
  /** True for an imported profile whose preamble the user has not confirmed. */
  needsConfirm: boolean
  /** The widest permission mode this profile may use on its agent, from Settings. */
  maxPermission: string
}

export type ForkAgentProfilesListResult = { profiles: ForkAgentProfileRow[] }

export type ForkAgentProfileResolveResult = {
  resolved: ForkAgentProfileResolved
}
