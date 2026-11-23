// Command guards (FORK.md, BAD-686): the fork.commandGuards.* RPC contract behind
// `orca command-guards`. Plain objects, no transforms: the mobile RPC fence refuses wider shapes.
import { z } from 'zod'
import type {
  CommandGuardAgentCoverage,
  CommandGuardAuditEntry,
  CommandGuardSurfaceCoverage
} from './command-guards'

export const ForkCommandGuardsListParams = z.object({})

export const ForkCommandGuardsStatusParams = z.object({})

/** Allow (or stop allowing) one rule for one project; no project means every project. */
export const ForkCommandGuardsAllowParams = z.object({
  rule: z.string().trim().min(1).max(60),
  /** A project's id, name or path; absent changes the host-wide list. */
  project: z.string().trim().min(1).max(600).optional(),
  /** False turns the rule back on. */
  allowed: z.boolean()
})

export type ForkCommandGuardsListResult = {
  entries: CommandGuardAuditEntry[]
  /** Blocked commands kept (newest first in `entries`). */
  limit: number
}

export type ForkCommandGuardsRuleRow = {
  rule: string
  summary: string
  /** Off for every project on this host. */
  offEverywhere: boolean
  /** Names of the projects that allow it. */
  allowedIn: string[]
}

export type ForkCommandGuardsStatusResult = {
  enabled: boolean
  rules: ForkCommandGuardsRuleRow[]
  agents: CommandGuardAgentCoverage[]
  /** Claude Code per surface; an older host sends none. */
  surfaces?: CommandGuardSurfaceCoverage[]
}

export type ForkCommandGuardsAllowResult = {
  rule: string
  project: string | null
  allowed: boolean
}
