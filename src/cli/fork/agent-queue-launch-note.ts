// SLRM-2098 (FORK.md "Agent launch queue"): the line `agent launch`, `worktree create --agent`
// and `orchestration worker-start` print when the launch waits in the host's agent queue.
import type { RuntimeClient } from '../runtime-client'
import {
  forkAgentQueuedLine,
  type ForkAgentQueueEntry,
  type ForkAgentQueueStatus
} from '../../shared/fork/agent-queue'

/** A new chat's first start reaches the gate just after the launch call returns. */
const STATUS_WAIT_MS = 1_500

/**
 * Where a launch that just returned stands. Null when the host has no queue, the launch is not
 * queued, or the question fails: the launch itself already succeeded either way.
 */
export async function readForkQueuedLaunch(
  client: RuntimeClient,
  target: { sessionId: string } | { dispatchId: string }
): Promise<ForkAgentQueueEntry | null> {
  try {
    const response = await client.call<ForkAgentQueueStatus>('fork.agentQueue.status', {
      ...target,
      waitMs: STATUS_WAIT_MS
    })
    return response.result.state === 'queued' ? response.result.entry : null
  } catch {
    return null
  }
}

/** Prints the queued line; with --json it goes to stderr so stdout stays one JSON document. */
export function printForkQueuedLaunch(entry: ForkAgentQueueEntry | null, json: boolean): void {
  if (!entry) {
    return
  }
  if (json) {
    console.error(forkAgentQueuedLine(entry))
  } else {
    console.log(forkAgentQueuedLine(entry))
  }
}

/** Hook (agent launch, worktree create --agent): a chat launch that waits says so. */
export async function noteForkQueuedAgentLaunch(
  client: RuntimeClient,
  outcome: { kind: string; sessionId?: string },
  json: boolean
): Promise<void> {
  if (outcome.kind === 'structured' && outcome.sessionId) {
    printForkQueuedLaunch(
      await readForkQueuedLaunch(client, { sessionId: outcome.sessionId }),
      json
    )
  }
}
