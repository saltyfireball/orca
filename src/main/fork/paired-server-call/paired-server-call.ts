// Paired server calls with a deadline of their own (SLRM-2447). The runtime transport's timeoutMs
// bounds only the socket send: before it, callOrchestrationWorkerServer prepares the server
// (ensureOrcadManagedTunnel -> connectionManager.connect), and for an SSH-managed server whose SSH
// target sits in "connecting" that never settles. A fan-out over paired servers that awaits such a
// call waits as long as the caller does (the CLI gives up at 60 s). Bounded here, the call rejects
// with `runtime_timeout` once its own timeoutMs passes, which every fan-out already reads as a
// server that did not answer.
import { withTimeoutResult } from '../../../shared/concurrency/promise-timeout-fallback'

export type ForkPairedServerCall = (
  environmentId: string,
  method: string,
  params: unknown,
  timeoutMs: number
) => Promise<unknown>

/** The same call, rejecting with code `runtime_timeout` when it has not settled after timeoutMs. */
export function boundedForkPairedCall(call: ForkPairedServerCall): ForkPairedServerCall {
  return async (environmentId, method, params, timeoutMs) => {
    // Settle the rejection first: withTimeoutResult reads one as a timeout.
    const read = await withTimeoutResult(
      call(environmentId, method, params, timeoutMs).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      ),
      timeoutMs
    )
    if (!read.ok) {
      throw Object.assign(new Error(`the paired server did not answer within ${timeoutMs} ms`), {
        code: 'runtime_timeout'
      })
    }
    if (!read.value.ok) {
      throw read.value.error
    }
    return read.value.value
  }
}
