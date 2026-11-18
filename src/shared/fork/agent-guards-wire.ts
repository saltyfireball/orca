// Agent guards (FORK.md, SLRM-2385): the fork.guards.* RPC contract behind `orca guards`, and the
// desktop window's bridge for the status line. No call carries text to send: the guard's message
// is fixed, and an answer to a paused agent goes through the Decision inbox's own answer.
import { z } from 'zod'
import { AGENT_GUARD_MAX_CAP_USD, type AgentGuardEntry } from './agent-guards'

// Plain objects with no transforms or defaults: the mobile RPC fence refuses a schema whose parsed
// shape is wider than what a sender may send.
export const ForkGuardsListParams = z.object({})

/** An id as `orca guards list` prints it, or a unique prefix of 4+ characters. */
export const ForkGuardsTargetParams = z.object({ id: z.string().trim().min(1).max(600) })

/** A chat session id (or a unique prefix) and its own cap in USD; 0 drops the chat's own cap. */
export const ForkGuardsCapParams = z.object({
  id: z.string().trim().min(1).max(600),
  usd: z.number().min(0).max(AGENT_GUARD_MAX_CAP_USD)
})

export type ForkGuardsListResult = { now: number; entries: AgentGuardEntry[] }

/**
 * - resumed: the pause is lifted (a chat's spend counts again from now).
 * - not-paused: it was not paused.
 */
export type ForkGuardsResumeResult = { id: string; outcome: 'resumed' | 'not-paused' }

export type ForkGuardsCapResult = {
  id: string
  /** The chat's own cap now, or null when it follows the default again. */
  capUsd: number | null
  spentUsd: number
}

export const FORK_AGENT_GUARDS_CHANNELS = {
  list: 'fork-agent-guards:list',
  resume: 'fork-agent-guards:resume',
  changed: 'fork-agent-guards:changed'
} as const

export type ForkAgentGuardsApi = {
  list: () => Promise<AgentGuardEntry[]>
  resume: (id: string) => Promise<ForkGuardsResumeResult>
  onChanged: (callback: (entries: AgentGuardEntry[]) => void) => () => void
}
