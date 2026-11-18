// Batch start (FORK.md, SLRM-2395): the phone's call. Auto goes to the paired desktop, which picks
// among itself and its paired servers; otherwise the picked repo's own host answers for itself.
import type { TuiAgent } from '../../../../../src/shared/agent-launch/catalog/tui-agent'
import { parseExecutionHostId } from '../../../../../src/shared/execution-host/execution-host'
import {
  FORK_BATCH_START_SETUP_TIMEOUT_MS,
  FORK_BATCH_START_TIMEOUT_MS,
  ForkBatchStartResultSchema,
  type ForkBatchStartRequest,
  type ForkBatchStartResult
} from '../../../../../src/shared/fork/batch-start'
import { bindDeferredRpcOperation, defineRpcOperation } from '../../../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../../../transport/rpc/rpc-operation-result-reader'
import type { RpcClient } from '../../../transport/rpc/rpc-client-contract'

export const forkBatchStartRun = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'fork.batch-start',
    method: 'fork.batchStart.start',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('fork-batch-start', ForkBatchStartResultSchema)
  })
)

export type MobileForkBatchTarget = {
  project: { id: string; name?: string }
  repoId: string
  /** The repo's execution host as its own host sees it ('local', 'ssh:...'). */
  repoHostId: string | null
}

/** The request for one prompt; `setupMissing` (SLRM-2406) applies to auto only. Exported for
 *  tests. */
export function mobileForkBatchRequest(
  target: MobileForkBatchTarget,
  auto: boolean,
  prompt: string,
  agents: TuiAgent[],
  setupMissing = false
): ForkBatchStartRequest {
  if (auto) {
    return {
      project: target.project,
      prompt,
      agents,
      placement: 'auto',
      ...(setupMissing ? { setupMissing: true } : {})
    }
  }
  const host = parseExecutionHostId(target.repoHostId)
  return {
    repo: `id:${target.repoId}`,
    ...(host?.kind === 'ssh' ? { repoHostId: host.id } : {}),
    prompt,
    agents,
    placement: 'here'
  }
}

export async function sendMobileForkBatchStart(
  client: RpcClient,
  request: ForkBatchStartRequest
): Promise<ForkBatchStartResult> {
  try {
    const response = await forkBatchStartRun.request(client, request, {
      timeoutMs: request.setupMissing
        ? FORK_BATCH_START_SETUP_TIMEOUT_MS
        : FORK_BATCH_START_TIMEOUT_MS
    })
    return forkBatchStartRun.interpret(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/method.?not.?found|unknown method/i.test(message)) {
      throw new Error(
        'That host runs stock Orca or an older Blackfish without batch start. Update it, or pick another.'
      )
    }
    throw error instanceof Error ? error : new Error(message)
  }
}
