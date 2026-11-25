// BAD-816 (FORK.md "Completion contract"): a worker_done the done checks, the result schema or the
// reviewer gate escalated after its last allowed round is stored as an escalation for the
// coordinator, and the Task stays open. That is a final answer, so the worker is told so (and the
// command fails) instead of an operation_unknown that sends it back with --retry-request.
import { RuntimeClientError } from '../runtime/connection/types'

export const WORKER_DONE_ESCALATED_CODE = 'worker_done_escalated'

export const WORKER_DONE_ESCALATED_TEXT =
  'This worker_done was not accepted. Its done checks, result or review still failed after the last allowed round, so Orca sent your report to the coordinator as an escalation, and the Task stays open. This is final: stop here and wait for the coordinator. Do not send worker_done again, and do not re-run it with --retry-request; it gives this same answer.'

/** The receipt of a worker_done the runtime stored as an escalation: the message it filed (local,
 *  or on the server that owns the worker), or a relay home without a lifecycle verdict, which only
 *  a worker_done changed into another type gets. */
function escalatedReceipt(result: unknown): { messageId?: string } | null {
  if (!result || typeof result !== 'object') {
    return null
  }
  const receipt = result as {
    message?: { id?: unknown; type?: unknown }
    relay?: { messageId?: unknown }
    lifecycle?: unknown
  }
  if (receipt.message?.type === 'escalation') {
    return typeof receipt.message.id === 'string' ? { messageId: receipt.message.id } : {}
  }
  if (receipt.relay && receipt.lifecycle === undefined) {
    return typeof receipt.relay.messageId === 'string' ? { messageId: receipt.relay.messageId } : {}
  }
  return null
}

/** Throws the final answer when this worker_done was escalated; nothing otherwise. */
export function forkRefuseEscalatedWorkerDone(type: string | undefined, result: unknown): void {
  if (type !== 'worker_done') {
    return
  }
  const escalated = escalatedReceipt(result)
  if (escalated) {
    throw new RuntimeClientError(WORKER_DONE_ESCALATED_CODE, WORKER_DONE_ESCALATED_TEXT, {
      escalated: true,
      ...(escalated.messageId ? { escalationMessageId: escalated.messageId } : {})
    })
  }
}
