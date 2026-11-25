// BAD-816: the two ends of a server's report going home, for the remote-owned rig. The server files
// the gated done in its peer Run mailbox, whose real queue triggers queue it; the home imports each
// queued item with the real import. Only the pull over the socket is skipped.
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { importRemoteOwnedItem } from '../../runtime/orchestration/db/remote-owned/remote-owned-import'
import { remoteServerPin } from '../../runtime/orchestration/db/remote-owned/remote-run-links'
import { isJsonRecord } from '../../../shared/fork/result-schema'

/** The conversation of the link a start opened for the home Run before it called the server. */
export function homeLinkConversation(homeDb: OrchestrationDb, runId: string): string {
  const link: unknown = homeDb.db
    .prepare('SELECT conversation_id FROM remote_run_links WHERE run_id = ?')
    .get(runId)
  return isJsonRecord(link) && typeof link.conversation_id === 'string' ? link.conversation_id : ''
}

/** What send-methods files once the gate let the done through. */
export function fileDoneOnServer(
  serverDb: OrchestrationDb,
  dispatchId: string,
  params: Record<string, unknown>
): void {
  const peerRunId = serverDb.getDispatchContextById(dispatchId)!.run_id
  serverDb.insertMessage({
    from: 'term_worker',
    to: `run:${peerRunId}`,
    subject: String(params.subject),
    body: String(params.body ?? ''),
    type: 'worker_done',
    payload: typeof params.payload === 'string' ? params.payload : undefined,
    runId: peerRunId,
    senderDispatchId: dispatchId
  })
}

/** Every item the server queued for home, imported in order. */
export function relayServerQueueHome(
  serverDb: OrchestrationDb,
  homeDb: OrchestrationDb,
  server: Parameters<typeof remoteServerPin>[0]
): void {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SQLite returns the columns this statement selects.
  const items = serverDb.db
    .prepare(
      "SELECT dispatch_id, sequence, message_id, kind, payload FROM federation_relay_items WHERE direction = 'to_home' ORDER BY sequence"
    )
    .all() as {
    dispatch_id: string
    sequence: number
    message_id: string
    kind: string
    payload: string
  }[]
  for (const item of items) {
    importRemoteOwnedItem(homeDb, remoteServerPin(server), {
      conversationId: item.dispatch_id,
      sequence: item.sequence,
      messageId: item.message_id,
      kind: item.kind,
      payload: item.payload
    })
  }
}
