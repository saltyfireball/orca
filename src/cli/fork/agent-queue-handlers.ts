// SLRM-2098 (FORK.md "Agent launch queue"): `orca agent queue list|start|cancel`.
import type { CommandHandler, HandlerContext } from '../dispatch'
import { getOptionalStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import type { ForkAgentQueueEntry, ForkAgentQueueSnapshot } from '../../shared/fork/agent-queue'

function explainRefusal(error: unknown): unknown {
  if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
    return new RuntimeClientError(
      'incompatible_runtime',
      'This Orca host has no agent launch queue. It needs a Blackfish build with SLRM-2098.'
    )
  }
  return error
}

function call<T>(ctx: HandlerContext, method: string, params: unknown) {
  return ctx.client.call<T>(method, params).catch((error: unknown) => {
    throw explainRefusal(error)
  })
}

function requiredId(ctx: HandlerContext): string {
  const id = getOptionalStringFlag(ctx.flags, 'id')
  if (!id) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Name the queued launch: its id from `orca agent queue list`.'
    )
  }
  return id
}

function entryLine(entry: ForkAgentQueueEntry): string {
  const kind = entry.kind === 'worker' ? 'worker' : 'chat'
  return `${String(entry.position).padStart(3)}  ${entry.id}  ${kind.padEnd(6)}  ${entry.label}`
}

export function formatQueue(snapshot: ForkAgentQueueSnapshot): string {
  const { live, limits } = snapshot
  const running = limits.separate
    ? `${live.interactive}/${limits.maxLive} user-started, ${live.worker}/${limits.maxWorkers} workers running`
    : `${live.interactive + live.worker}/${limits.maxLive} agents running`
  const head = snapshot.enabled ? running : 'The agent limit is off; nothing waits.'
  const held = snapshot.heldReason ? [`New launches are held: ${snapshot.heldReason}`] : []
  if (snapshot.entries.length === 0) {
    return [head, ...held, 'No launches waiting.'].join('\n')
  }
  return [head, ...held, '  #  ID        KIND    CHAT', ...snapshot.entries.map(entryLine)].join(
    '\n'
  )
}

export const FORK_AGENT_QUEUE_HANDLERS: Record<string, CommandHandler> = {
  'agent queue list': async (ctx) => {
    printResult(
      await call<ForkAgentQueueSnapshot>(ctx, 'fork.agentQueue.list', {}),
      ctx.json,
      formatQueue
    )
  },
  'agent queue start': async (ctx) => {
    const id = requiredId(ctx)
    const result = await call<{ started: boolean }>(ctx, 'fork.agentQueue.start', { id })
    if (!result.result.started) {
      process.exitCode = 1
    }
    printResult(result, ctx.json, (value) =>
      value.started ? `Started ${id}.` : `No queued launch ${id}; it may have started already.`
    )
  },
  'agent queue cancel': async (ctx) => {
    const id = requiredId(ctx)
    const result = await call<{ cancelled: boolean }>(ctx, 'fork.agentQueue.cancel', { id })
    if (!result.result.cancelled) {
      process.exitCode = 1
    }
    printResult(result, ctx.json, (value) =>
      value.cancelled ? `Cancelled ${id}.` : `No queued launch ${id}; it may have started already.`
    )
  }
}
