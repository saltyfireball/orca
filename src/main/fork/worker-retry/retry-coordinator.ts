// Worker retry (BAD-765, FORK.md): who a restart is started as. A Run bound to a terminal
// coordinator starts it as that terminal's handle. A Run a native chat coordinates has no handle,
// so the restart is started as that chat's own session, the way its own worker-start would be.
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { RunRow } from '../../runtime/orchestration/db/orchestration-records'
import { currentRunCoordinatorOrcaSessionId } from '../../runtime/orchestration/db/runs/run-coordinator-orca-session'
import { resolveWorkerLineage } from '../../runtime/orchestration/db/dispatch-context/worker-follow-up-lineage'
import { resolveOrcaSessionParty } from '../../runtime/orchestration/addressing/orchestration-party'
import type { OrchestrationSessionCaller } from '../../runtime/orchestration/addressing/orchestration-caller-identity'
import { readActingSessionRecord } from '../../runtime/rpc/orchestration/callers/orchestration-session-caller'

export type RetryCoordinator = {
  from: string
  /** Set for a chat coordinator: the session identity a worker-start from it carries. */
  caller?: OrchestrationSessionCaller
}

/** Why a restart of this Dispatch's worker could not start at all, read without side effects, so the
 *  coordinator is told Orca is retrying only when it can. */
export function restartBlocker(
  db: OrchestrationDb,
  runId: string,
  dispatchId: string
): 'cannot-resume' | 'no-coordinator' | null {
  const lineage = resolveWorkerLineage(db, dispatchId)
  if (
    !lineage ||
    db.getFederatedDispatch(lineage.latest.id) ||
    !db.getWorkerDispatch(lineage.resource?.origin_dispatch_id ?? lineage.latest.id)
  ) {
    return 'cannot-resume'
  }
  const run = db.getRun(runId)
  const hasCoordinator =
    run?.coordinator_handle ||
    (run && currentRunCoordinatorOrcaSessionId(run)) ||
    db.getActiveCoordinatorRun?.()?.coordinator_handle
  return hasCoordinator ? null : 'no-coordinator'
}

/** The coordinator a restart is started as, or why there is none. */
export async function resolveRetryCoordinator(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  run: RunRow | undefined
): Promise<RetryCoordinator | { refused: string }> {
  if (run?.coordinator_handle) {
    return { from: run.coordinator_handle }
  }
  const sessionId = run ? currentRunCoordinatorOrcaSessionId(run) : null
  if (sessionId) {
    try {
      const { record } = await readActingSessionRecord(runtime, sessionId, 'orchestration.send')
      const caller: OrchestrationSessionCaller = Object.freeze({
        ...resolveOrcaSessionParty(sessionId, db),
        sessionId,
        workspaceId: record.location.workspaceId
      })
      return { from: caller.address, caller }
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error)
      return {
        refused: `its coordinator chat cannot start workers now: ${why}`
      }
    }
  }
  const legacy = db.getActiveCoordinatorRun?.()?.coordinator_handle
  return legacy ? { from: legacy } : { refused: 'no coordinator' }
}
