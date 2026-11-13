// Sleepers (SLRM-2136): read the chat stall monitor and the launch queue for the list. Neither is
// created here; a feature that never ran contributes nothing.
import type { SleeperOverlay } from '../../../shared/fork/sleepers'
import { sleeperLifecycleOverlay } from '../../../shared/fork/sleepers-lifecycle'
import { forkAgentQueueSnapshot } from '../agent-queue/agent-queue-service'
import { forkChatStallEntries } from '../chat-stall/chat-stall-service'

export function forkSleeperLifecycleOverlay(): Pick<SleeperOverlay, 'stalled' | 'queued'> {
  return sleeperLifecycleOverlay(forkChatStallEntries(), forkAgentQueueSnapshot().entries)
}
