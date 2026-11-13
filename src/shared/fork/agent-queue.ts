// SLRM-2098 (FORK.md "Agent launch queue"): a limit on how many agents run at once. Launches
// past the limit wait in a queue and start when a slot frees. Shared by main, preload, the
// renderer and the CLI.
import { z } from 'zod'

/** User-started launches go ahead of orchestration workers. */
export type ForkAgentQueueKind = 'interactive' | 'worker'

export type ForkAgentQueueEntry = {
  /** The ticket id `start` and `cancel` take. */
  id: string
  /** The chat session the queued launch starts. */
  sessionId: string
  label: string
  kind: ForkAgentQueueKind
  /** 1-based place in the whole queue, in the order launches will start. */
  position: number
  queuedAt: number
  /** Set for an orchestration worker. */
  dispatchId?: string
}

export type ForkAgentQueueSnapshot = {
  enabled: boolean
  /** Agents whose provider process runs now, by kind. */
  live: { interactive: number; worker: number }
  limits: { separate: boolean; maxLive: number; maxWorkers: number }
  /** Why new launches are held even with free slots (the memory seam), if they are. */
  heldReason?: string
  entries: ForkAgentQueueEntry[]
}

export const FORK_AGENT_QUEUE_DEFAULT_MAX_LIVE = 8
export const FORK_AGENT_QUEUE_MAX_LIMIT = 256

/** The settings as main reads them; anything unset takes the stranger-safe default. */
export type ForkAgentQueueConfig = {
  enabled: boolean
  maxLive: number
  separate: boolean
  maxWorkers: number
  resumeBypass: boolean
}

function clampLimit(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(FORK_AGENT_QUEUE_MAX_LIMIT, Math.max(1, Math.round(value)))
    : FORK_AGENT_QUEUE_DEFAULT_MAX_LIVE
}

export function forkAgentQueueConfigOf(settings: {
  forkAgentQueueEnabled?: boolean
  forkAgentQueueMaxLive?: number
  forkAgentQueueSeparateLimits?: boolean
  forkAgentQueueMaxWorkers?: number
  forkAgentQueueResumeBypass?: boolean
}): ForkAgentQueueConfig {
  return {
    enabled: settings.forkAgentQueueEnabled === true,
    maxLive: clampLimit(settings.forkAgentQueueMaxLive),
    separate: settings.forkAgentQueueSeparateLimits === true,
    maxWorkers: clampLimit(settings.forkAgentQueueMaxWorkers),
    resumeBypass: settings.forkAgentQueueResumeBypass !== false
  }
}

export const FORK_AGENT_QUEUE_CHANNELS = {
  /** main -> renderer: the queue changed. */
  changed: 'fork:agentQueue:changed',
  get: 'fork:agentQueue:get',
  start: 'fork:agentQueue:start',
  cancel: 'fork:agentQueue:cancel'
} as const

export type ForkAgentQueueApi = {
  get: () => Promise<ForkAgentQueueSnapshot>
  /** Start a queued launch now, past the limit. */
  start: (id: string) => Promise<boolean>
  cancel: (id: string) => Promise<boolean>
  onChanged: (callback: (snapshot: ForkAgentQueueSnapshot) => void) => () => void
}

const Id = z.string().trim().min(1).max(512)

export const ForkAgentQueueListParams = z.object({}).passthrough()

/** Where one launch stands; `wait` lets a launch that just returned reach its gate first. */
export const ForkAgentQueueStatusParams = z
  .object({
    sessionId: Id.optional(),
    dispatchId: Id.optional(),
    waitMs: z.number().int().min(0).max(5_000).optional()
  })
  .refine((value) => Boolean(value.sessionId) !== Boolean(value.dispatchId), {
    message: 'Pass a session or a dispatch'
  })

export const ForkAgentQueueTicketParams = z.object({ id: Id })

export type ForkAgentQueueStatus =
  | { state: 'queued'; entry: ForkAgentQueueEntry }
  | { state: 'not-queued' }

/** The line launch commands print for a queued launch. */
export function forkAgentQueuedLine(entry: Pick<ForkAgentQueueEntry, 'position' | 'id'>): string {
  return `queued, position ${entry.position} (start now: orca agent queue start ${entry.id})`
}
