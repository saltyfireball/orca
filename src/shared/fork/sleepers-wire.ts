// Sleepers (FORK.md): the fork.sleepers.* RPC contract shared by the dialog, `orca sleepers` and
// the host that answers.
import { z } from 'zod'
import type { SleeperRow } from './sleepers'

/**
 * - asleep: the provider stopped.
 * - already-asleep: no provider was running.
 * - busy: the idle sweep's checks refused (a turn, a prompt, queued sends or child work).
 * - not-found: this host has no such chat.
 * - unavailable: the chat host or its idle sweep is not running here.
 */
export type ForkSleepResult = 'asleep' | 'already-asleep' | 'busy' | 'not-found' | 'unavailable'

export type ForkSleepOutcome = { sessionId: string; result: ForkSleepResult }

/** Most chats one sleep request may name. */
export const FORK_SLEEPERS_MAX_SLEEP_IDS = 500

const SessionId = z.string().min(1).max(512)

export const ForkSleepersListParams = z.object({})

export const ForkSleepersSleepParams = z
  .object({
    sessionIds: z.array(SessionId).max(FORK_SLEEPERS_MAX_SLEEP_IDS).optional(),
    /** Every idle, unpinned local chat. */
    allIdle: z.boolean().optional(),
    /** With allIdle: leave chats on screen awake. */
    exceptVisible: z.boolean().optional()
  })
  .refine((value) => (value.sessionIds?.length ?? 0) > 0 || value.allIdle === true, {
    message: 'Name a chat or ask for all idle chats.'
  })

export const ForkSleepersPinParams = z.object({
  sessionId: SessionId,
  pinned: z.boolean()
})

export type ForkSleepersListResult = { now: number; rows: SleeperRow[] }
export type ForkSleepersSleepResult = { outcomes: ForkSleepOutcome[] }
export type ForkSleepersPinResult = { sessionId: string; pinned: boolean; pinnedCount: number }
