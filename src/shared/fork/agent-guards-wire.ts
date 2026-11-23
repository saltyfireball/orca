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
  usd: z.number().min(0).max(AGENT_GUARD_MAX_CAP_USD),
  /** BAD-679: cap the whole Run the chat belongs to (its coordinator and workers together). */
  run: z.boolean().optional()
})

const AutomationCapValue = z.number().min(0).max(AGENT_GUARD_MAX_CAP_USD).nullable().optional()

/**
 * BAD-679: one automation's own caps in USD. A number sets that cap (0 is none), null follows the
 * default setting again, and a key left out is unchanged.
 */
export const ForkGuardsAutomationCapParams = z.object({
  id: z.string().trim().min(1).max(200),
  run: AutomationCapValue,
  day: AutomationCapValue,
  week: AutomationCapValue
})

/** A Run (BAD-679): a coordinator and its workers, with a cap that covers them together. */
export type ForkGuardsRunRow = {
  rootId: string
  title: string
  agents: number
  /** BAD-766: agents of the Run with no usage record, so their spend is not in `spentUsd`. */
  uncounted?: number
  spentUsd: number
  capUsd: number
}

/** An automation's caps and what its runs have spent (BAD-679); a cap of 0 is none. */
export type ForkGuardsAutomationRow = {
  id: string
  name: string
  runCapUsd: number
  dayCapUsd: number
  weekCapUsd: number
  daySpentUsd: number
  weekSpentUsd: number
  /** Further scheduled runs are skipped now. */
  skipping: boolean
}

export type ForkGuardsListResult = {
  now: number
  entries: AgentGuardEntry[]
  /** Runs with a cap, and automations with one (BAD-679); absent from an older host. */
  runs?: ForkGuardsRunRow[]
  automations?: ForkGuardsAutomationRow[]
}

export type ForkGuardsAutomationCapResult = {
  id: string
  runCapUsd: number
  dayCapUsd: number
  weekCapUsd: number
}

/**
 * - resumed: the pause is lifted (a chat's spend counts again from now).
 * - not-paused: it was not paused.
 */
export type ForkGuardsResumeResult = { id: string; outcome: 'resumed' | 'not-paused' }

export type ForkGuardsCapResult = {
  id: string
  /** BAD-679: `run` when the cap covers the chat's whole Run (id is then its coordinator). */
  scope?: 'chat' | 'run'
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
