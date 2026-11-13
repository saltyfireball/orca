// Sleepers (SLRM-2136): the fork's other agent states as list overlays. Chat stall entries become
// `stalled` rows and launch queue entries `queued` rows; their actions stay with those features.
import type { ForkAgentQueueEntry } from './agent-queue'
import type { ForkChatStallEntry } from './chat-stall'
import type { SleeperOverlay } from './sleepers'

export function sleeperLifecycleOverlay(
  stalls: readonly ForkChatStallEntry[],
  queue: readonly ForkAgentQueueEntry[]
): Required<Pick<SleeperOverlay, 'stalled' | 'queued'>> {
  return {
    stalled: new Map(
      stalls.map((entry) => [
        entry.sessionId,
        { quietSince: entry.quietSince, liveness: entry.liveness }
      ])
    ),
    queued: new Map(
      queue.map((entry) => [
        entry.sessionId,
        {
          id: entry.id,
          position: entry.position,
          label: entry.label,
          queuedAt: entry.queuedAt,
          ...(entry.heldReason ? { heldReason: entry.heldReason } : {})
        }
      ])
    )
  }
}
