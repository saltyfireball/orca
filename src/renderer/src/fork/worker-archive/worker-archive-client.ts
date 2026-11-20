// Worker archive (FORK.md, BAD-669): the renderer's calls to a host's fork.workerCleanup.* RPC.
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type {
  ForkWorkerArchiveStatus,
  ForkWorkerCleanupResult,
  ForkWorkerCleanupRunParams
} from '../../../../shared/fork/worker-archive'
import type { RuntimeClientTarget } from '../../../../shared/remote-runtime/host-catalog/runtime-client-target'

const LOCAL: RuntimeClientTarget = { kind: 'local' }

export function runForkWorkerCleanup(
  params: ForkWorkerCleanupRunParams,
  target: RuntimeClientTarget = LOCAL
): Promise<ForkWorkerCleanupResult> {
  return callRuntimeRpc<ForkWorkerCleanupResult>(target, 'fork.workerCleanup.run', params)
}

export async function readForkWorkerArchiveStatus(
  target: RuntimeClientTarget = LOCAL
): Promise<ForkWorkerArchiveStatus[]> {
  const answer = await callRuntimeRpc<{ status: ForkWorkerArchiveStatus[] }>(
    target,
    'fork.workerCleanup.status',
    {}
  )
  return Array.isArray(answer.status) ? answer.status : []
}

export async function reportForkWorkspaceFocus(
  clientId: string,
  worktreeId: string | null,
  target: RuntimeClientTarget = LOCAL
): Promise<void> {
  await callRuntimeRpc(target, 'fork.workerCleanup.focus', { clientId, worktreeId })
}
