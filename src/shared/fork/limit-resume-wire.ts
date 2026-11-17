// Limit resume (FORK.md, SLRM-2309): the fork.limits.* RPC contract behind `orca limits`, and the
// desktop window's bridge. Neither carries text to type: the resume message is only ever the
// host's own setting.
import { z } from 'zod'
import type { LimitResumeEntry } from './limit-resume'

// Plain objects with no transforms or defaults: the mobile RPC fence refuses a schema whose parsed
// shape is wider than what a sender may send.
export const ForkLimitsListParams = z.object({})

/** An id as `orca limits list` prints it, or a unique prefix of 4+ characters. */
export const ForkLimitsTargetParams = z.object({ id: z.string().trim().min(1).max(600) })

export type ForkLimitsListResult = { now: number; entries: LimitResumeEntry[] }

/**
 * - sent: the agent was told to go on.
 * - refused: nothing was sent (busy, someone typing, or no live terminal).
 * - unknown: the send failed after it may have arrived; it is not sent again.
 * - cancelled: it will not be resumed for this stop.
 */
export type ForkLimitsActionOutcome = 'sent' | 'refused' | 'unknown' | 'cancelled'

export type ForkLimitsActionResult = { entry: LimitResumeEntry; outcome: ForkLimitsActionOutcome }

export const FORK_LIMIT_RESUME_CHANNELS = {
  list: 'fork-limit-resume:list',
  changed: 'fork-limit-resume:changed'
} as const

export type ForkLimitResumeApi = {
  list: () => Promise<LimitResumeEntry[]>
  onChanged: (callback: (entries: LimitResumeEntry[]) => void) => () => void
}
