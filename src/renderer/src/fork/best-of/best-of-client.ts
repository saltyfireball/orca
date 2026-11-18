// Best of N (FORK.md, SLRM-2393): the window's calls. fork.bestOf.* goes to this machine's Orca;
// the diff and the pick go to the host that owns each worktree, over the stock RPC.
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type { ForkBestOfCall } from '../../../../shared/fork/best-of/best-of-compare'
import type {
  ForkBestOfListResult,
  ForkBestOfShowResult
} from '../../../../shared/fork/best-of/best-of-wire'

/** An archive or a removal waits for Git; give it room. */
const CALL_TIMEOUT_MS = 5 * 60_000

export const forkBestOfCall: ForkBestOfCall = (environmentId, method, params) =>
  callRuntimeRpc<unknown>(
    environmentId === null ? { kind: 'local' } : { kind: 'environment', environmentId },
    method,
    params,
    { timeoutMs: CALL_TIMEOUT_MS }
  )

export async function listForkBestOfRuns(): Promise<ForkBestOfListResult> {
  return (await forkBestOfCall(null, 'fork.bestOf.list', {})) as ForkBestOfListResult
}

export async function showForkBestOfRun(id: string): Promise<ForkBestOfShowResult> {
  return (await forkBestOfCall(null, 'fork.bestOf.show', { id })) as ForkBestOfShowResult
}

export async function forgetForkBestOfRun(id: string): Promise<void> {
  await forkBestOfCall(null, 'fork.bestOf.forget', { id })
}

export function forkBestOfAvailable(): boolean {
  return Boolean(window.api?.runtime?.call)
}
