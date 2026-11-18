// Batch start (FORK.md, SLRM-2395): sends one prompt to the machine that will take it. Auto asks
// this desktop's runtime, which picks among it and its paired servers; otherwise the composer's
// run target answers for itself (a paired server over its own runtime RPC).
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import { parseExecutionHostId } from '../../../../shared/execution-host/execution-host'
import {
  FORK_BATCH_START_TIMEOUT_MS,
  ForkBatchStartResultSchema,
  type ForkBatchStartRequest,
  type ForkBatchStartResult
} from '../../../../shared/fork/batch-start'
import type { RuntimeClientTarget } from '../../../../shared/remote-runtime/host-catalog/runtime-client-target'

export type ForkBatchTarget = {
  project: { id: string; name?: string }
  repoId: string
  /** The composer's run target ('local', 'ssh:...', 'runtime:...'). */
  hostId: string | null
}

/** Where the request goes and what it asks for. Exported for tests. */
export function forkBatchRoute(
  target: ForkBatchTarget,
  auto: boolean,
  prompt: string,
  agents: TuiAgent[]
): { runtime: RuntimeClientTarget; request: ForkBatchStartRequest } {
  if (auto) {
    return {
      runtime: { kind: 'local' },
      request: { project: target.project, prompt, agents, placement: 'auto' }
    }
  }
  const host = parseExecutionHostId(target.hostId)
  const repo = `id:${target.repoId}`
  if (host?.kind === 'runtime') {
    return {
      runtime: { kind: 'environment', environmentId: host.environmentId },
      request: { repo, prompt, agents, placement: 'here' }
    }
  }
  return {
    runtime: { kind: 'local' },
    request: {
      repo,
      ...(host?.kind === 'ssh' ? { repoHostId: host.id } : {}),
      prompt,
      agents,
      placement: 'here'
    }
  }
}

function friendly(error: unknown): Error {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'method_not_found') {
    return new Error(
      'That machine runs stock Orca or an older Blackfish without batch start. Update it, or pick another.'
    )
  }
  return error instanceof Error ? error : new Error(String(error))
}

export async function sendForkBatchStart(
  target: ForkBatchTarget,
  auto: boolean,
  prompt: string,
  agents: TuiAgent[]
): Promise<ForkBatchStartResult> {
  const route = forkBatchRoute(target, auto, prompt, agents)
  try {
    const result = await callRuntimeRpc<unknown>(
      route.runtime,
      'fork.batchStart.start',
      route.request,
      { timeoutMs: FORK_BATCH_START_TIMEOUT_MS }
    )
    return ForkBatchStartResultSchema.parse(result)
  } catch (error) {
    throw friendly(error)
  }
}
