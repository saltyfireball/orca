// Snooze (FORK.md, SLRM-2269): the fork.snooze.* RPC contract behind `orca snooze`, and the
// desktop window's bridge. No call here carries a command: the settle cleanup command is only ever
// the user's own setting, and only the desktop window's settle call can start it.
import { z } from 'zod'
import type {
  ForkSnoozeEntry,
  ForkSnoozeTarget,
  ForkSnoozeUntil,
  ForkSnoozeWakeReason
} from './snooze'
import { FORK_SNOOZE_MAX_AHEAD_MS, FORK_SNOOZE_MAX_IDLE_DAYS } from './snooze'

const Text = z.string().trim().min(1).max(512)

// Plain objects with no transforms or defaults: the mobile RPC fence refuses a schema whose parsed
// shape is wider than what a sender may send.
export const ForkSnoozeListParams = z.object({})

export const ForkSnoozeSetParams = z.object({
  /** A workspace selector (path:, id:, branch: and the rest), or chat:<session id or pane key>. */
  target: Text,
  /** merge, idle:<days>d, a duration, a preset, a clock time or a date and time. */
  until: z.string().trim().min(1).max(64),
  /** A paired server's host id (runtime:<id>) when the workspace is not on this machine. */
  host: z.string().trim().min(1).max(256).optional()
})

export const ForkSnoozeWakeParams = z.object({ id: Text })

export type ForkSnoozeListResult = { now: number; entries: ForkSnoozeEntry[] }
export type ForkSnoozeSetResult = { entry: ForkSnoozeEntry }
export type ForkSnoozeWakeResult = { entry: ForkSnoozeEntry }

export const FORK_SNOOZE_CHANNELS = {
  list: 'fork-snooze:list',
  snooze: 'fork-snooze:snooze',
  wake: 'fork-snooze:wake',
  settle: 'fork-snooze:settle',
  changed: 'fork-snooze:changed'
} as const

const Id = z.string().min(1).max(512)
const HostId = z.string().min(1).max(512)

export const ForkSnoozeTargetSchema = z.union([
  z.object({ kind: z.literal('workspace'), worktreeId: Id, hostId: HostId }),
  z.object({
    kind: z.literal('chat'),
    paneKey: Id,
    worktreeId: Id.nullable(),
    hostId: HostId,
    sessionId: Id.optional()
  })
])

export const ForkSnoozeUntilSchema = z.union([
  z.object({ kind: z.literal('time'), at: z.number().int().positive() }),
  z.object({ kind: z.literal('merge') }),
  z.object({
    kind: z.literal('idle'),
    days: z.number().int().min(1).max(FORK_SNOOZE_MAX_IDLE_DAYS)
  })
])

export const ForkSnoozeRequestSchema = z.object({
  target: ForkSnoozeTargetSchema,
  until: ForkSnoozeUntilSchema,
  label: z.string().max(512)
})

export type ForkSnoozeRequest = {
  target: ForkSnoozeTarget
  until: ForkSnoozeUntil
  label: string
}

/** What the window knows of a settling workspace, for the cleanup command's environment. */
export const ForkSnoozeSettleContextSchema = z.object({
  path: z.string().max(4096).optional(),
  branch: z.string().max(1024).optional()
})

export type ForkSnoozeSettleContext = z.infer<typeof ForkSnoozeSettleContextSchema>

export type ForkSnoozeSettleOutcome = {
  woke: boolean
  /** Whether the cleanup command ran, and how it ended. */
  cleanup: 'none' | 'ok' | 'failed' | 'timeout'
}

/** window.api.forkSnooze: the desktop window's side. */
export type ForkSnoozeApi = {
  list: () => Promise<ForkSnoozeEntry[]>
  snooze: (request: ForkSnoozeRequest) => Promise<ForkSnoozeEntry | null>
  wake: (id: string, reason: ForkSnoozeWakeReason) => Promise<boolean>
  settle: (
    id: string,
    reason: ForkSnoozeWakeReason,
    context: ForkSnoozeSettleContext
  ) => Promise<ForkSnoozeSettleOutcome>
  onChanged: (callback: (entries: ForkSnoozeEntry[]) => void) => () => void
}

/** A timed snooze from the window must lie ahead, within the year. */
export function isForkSnoozeUntilInRange(until: ForkSnoozeUntil, now: number): boolean {
  return until.kind !== 'time' || (until.at > now && until.at - now <= FORK_SNOOZE_MAX_AHEAD_MS)
}
