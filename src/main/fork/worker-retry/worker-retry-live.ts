// Worker retry policy (BAD-681, FORK.md): the live wiring and the one hook upstream's stop report
// calls.
// - `forkWorkerRetryOnStop(db, dispatch, stop)`: from the stop report of a local worker, before it
//   is mailed. When the policy says to retry, the restart is recorded and scheduled, and the
//   coordinator gets a notice that says so instead of a demand to act. Otherwise it returns
//   undefined and the report goes out as before.
// - `installForkWorkerRetry(runtime, db)`: from where the orchestration database opens; gives the
//   hook the runtime to start workers with, and arms restarts a quit left waiting.
// A restart is the worker's own follow-up path: the same workspace, its saved conversation when the
// agent keeps one, and the Task's original spec.
import { isForkPauseAllEngaged } from '../pause-all/pause-all-state'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { DispatchContextRow } from '../../runtime/orchestration/db/orchestration-records'
import {
  planWorkerFollowUp,
  startWorkerFollowUp
} from '../../runtime/rpc/methods/orchestration/messaging/worker-follow-up'
import { escalateWorkerFailure } from '../../runtime/orchestration/workers/reports/worker-failure-escalation'
import { dispatchReportMailbox } from '../../runtime/orchestration/workers/reports/dispatch-report-mailbox'
import {
  decideWorkerRetry,
  resolveWorkerRetryPolicy,
  type WorkerRetryHold,
  type WorkerRetryStop
} from '../../../shared/fork/worker-retry'
import {
  countRetryChain,
  listScheduled,
  readRetryOf,
  readRunPolicy,
  recordRetry,
  settleRetry
} from './retry-store'

type Live = { runtime: OrcaRuntimeService; db: OrchestrationDb }

let live: Live | null = null
/** A restart that came due while pause-all is engaged looks again this often. */
const PAUSED_RECHECK_MS = 30_000
const timers = new Map<string, ReturnType<typeof setTimeout>>()

export function installForkWorkerRetry(runtime: OrcaRuntimeService, db: OrchestrationDb): void {
  for (const timer of timers.values()) {
    clearTimeout(timer)
  }
  timers.clear()
  live = { runtime, db }
  // After the open returns, so a restart can use the database it is opening.
  setTimeout(() => {
    if (live?.db !== db) {
      return
    }
    try {
      for (const entry of listScheduled(db)) {
        arm(db, entry.dispatchId, entry.dueAtMs)
      }
    } catch (error) {
      console.warn('[orchestration] worker retries were not re-armed', error)
    }
  }, 0).unref?.()
}

export type ForkWorkerRetryNotice = { subject: string; body: (task: string) => string }

/** True when a worker sent its own worker_done for this Dispatch and the lifecycle took it. */
function workerSentDone(db: OrchestrationDb, dispatchId: string): boolean {
  const row = db.db
    .prepare(
      `SELECT 1 FROM messages
        WHERE type = 'worker_done' AND json_valid(payload)
          AND json_extract(payload, '$.dispatchId') = ?
          AND json_type(payload, '$._orcaLifecycleRejection.code') IS NOT 'text'
        LIMIT 1`
    )
    .get(dispatchId)
  return row !== undefined
}

function formatDelay(ms: number): string {
  const seconds = Math.round(ms / 1000)
  return seconds >= 120 ? `${Math.round(seconds / 60)} minutes` : `${seconds} seconds`
}

export function forkWorkerRetryOnStop(
  db: OrchestrationDb,
  dispatch: Pick<DispatchContextRow, 'id' | 'run_id' | 'task_id'>,
  stop: WorkerRetryStop
): ForkWorkerRetryNotice | undefined {
  if (!live || live.db !== db) {
    return undefined
  }
  try {
    const settings = live.runtime.requireStore().getSettings() as never
    const policy = resolveWorkerRetryPolicy(settings, readRunPolicy(db, dispatch.run_id))
    const earlier = readRetryOf(db, dispatch.id)
    const noticeOf = (attempt: number, delayMs: number, reason: string): ForkWorkerRetryNotice => ({
      subject: 'Worker ended; Orca is retrying it',
      body: (task) =>
        `The worker of ${task} ended: ${reason}. Orca will restart it in the same workspace in about ${formatDelay(delayMs)} (automatic retry ${attempt} of ${policy.max}). Do not start it again yourself; you hear again if the retry fails or the limit is reached. \`orca retry show --task ${dispatch.task_id}\` lists the retries.`
    })
    if (earlier && earlier.status !== 'cancelled') {
      // The same stop reported again: it is the same retry.
      return noticeOf(
        earlier.attempt,
        Math.max(0, Date.parse(earlier.dueAt) - Date.now()),
        earlier.reason
      )
    }
    const decision = decideWorkerRetry({
      policy,
      stop,
      attemptsUsed: countRetryChain(db, dispatch.id),
      workerReported: workerSentDone(db, dispatch.id),
      taskStatus: db.getTask(dispatch.task_id, dispatch.run_id)?.status ?? null
    })
    if (!decision.retry) {
      return undefined
    }
    const dueAtMs = Date.now() + decision.delayMs
    if (
      !recordRetry(db, {
        taskId: dispatch.task_id,
        runId: dispatch.run_id,
        dispatchId: dispatch.id,
        attempt: decision.attempt,
        reason: decision.reason,
        dueAtMs
      })
    ) {
      return undefined
    }
    arm(db, dispatch.id, dueAtMs)
    return noticeOf(decision.attempt, decision.delayMs, decision.reason)
  } catch (error) {
    // A failure here must never hide the report: it goes to the coordinator as it always did.
    console.warn('[orchestration] worker retry decision failed', dispatch.id, error)
    return undefined
  }
}

function arm(db: OrchestrationDb, dispatchId: string, dueAtMs: number): void {
  const existing = timers.get(dispatchId)
  if (existing) {
    clearTimeout(existing)
  }
  const timer = setTimeout(
    () => {
      timers.delete(dispatchId)
      // Pause all (BAD-685, FORK.md): a due restart waits while paused and stays scheduled.
      if (isForkPauseAllEngaged()) {
        arm(db, dispatchId, Date.now() + PAUSED_RECHECK_MS)
        return
      }
      void runRetry(db, dispatchId)
    },
    Math.min(Math.max(0, dueAtMs - Date.now()), 2 ** 31 - 1)
  )
  timer.unref?.()
  timers.set(dispatchId, timer)
}

const NOT_RETRIED: Record<WorkerRetryHold | 'steered', string> = {
  off: 'retries were switched off',
  'worker-reported': 'the worker reported',
  'task-settled': 'the Task is settled',
  'not-a-failure': 'the worker had not failed',
  deliberate: 'the worker was closed on purpose',
  'never-started': 'the worker never started',
  'not-transient': 'the error is not one a retry fixes',
  exhausted: 'the limit was reached',
  steered: 'the worker was already started again'
}

/** The coordinator hears when a retry did not happen, as a normal escalation that needs it. */
function escalateFailedRetry(db: OrchestrationDb, dispatchId: string, why: string): void {
  const dispatch = db.getDispatchContextById(dispatchId)
  if (!dispatch || !live) {
    return
  }
  const { runtime } = live
  escalateWorkerFailure(
    db,
    dispatch,
    {
      id: `msg_retry_failed_${dispatchId}`,
      from: `dispatch:${dispatchId}`,
      mailbox: () => dispatchReportMailbox(db, dispatch),
      describe: (task) => ({
        subject: 'Automatic retry did not start',
        body: `Orca could not restart the worker of ${task}: ${why}. Retry it yourself or tell the user (see the recovery reference).`
      }),
      payload: { taskId: dispatch.task_id, dispatchId, retryFailed: why }
    },
    (handle, type) => runtime.notifyMessageArrived(handle, type)
  )
}

async function runRetry(db: OrchestrationDb, dispatchId: string): Promise<void> {
  if (!live || live.db !== db) {
    return
  }
  const { runtime } = live
  try {
    const entry = readRetryOf(db, dispatchId)
    const dispatch = db.getDispatchContextById(dispatchId)
    if (!entry || entry.status !== 'scheduled' || !dispatch) {
      return
    }
    const task = db.getTask(dispatch.task_id, dispatch.run_id)
    if (task?.status === 'completed' || task?.status === 'failed') {
      settleRetry(db, dispatchId, 'cancelled', { detail: NOT_RETRIED['task-settled'] })
      return
    }
    const plan = planWorkerFollowUp(db, dispatchId, 'dispatch')
    if (plan?.kind === 'steer') {
      settleRetry(db, dispatchId, 'cancelled', { detail: NOT_RETRIED.steered })
      return
    }
    const run = db.getRun?.(dispatch.run_id)
    const from = run?.coordinator_handle ?? db.getActiveCoordinatorRun?.()?.coordinator_handle
    if (plan?.kind !== 'start' || !from) {
      const why = plan?.kind !== 'start' ? 'this worker cannot be resumed' : 'no coordinator'
      settleRetry(db, dispatchId, 'failed', { detail: why })
      escalateFailedRetry(db, dispatchId, why)
      return
    }
    const spec = typeof task?.spec === 'string' ? task.spec : ''
    const outcome = await startWorkerFollowUp({
      ctx: { runtime },
      db,
      plan,
      from,
      message: {
        subject: `Automatic retry ${entry.attempt} after a failure`,
        body: retryBrief(entry.attempt, entry.reason, spec)
      }
    })
    if (outcome.kind === 'steer') {
      settleRetry(db, dispatchId, 'cancelled', { detail: NOT_RETRIED.steered })
      return
    }
    const started = outcome.receipt.dispatchId
    settleRetry(db, dispatchId, 'started', {
      retryDispatchId: typeof started === 'string' ? started : null
    })
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    try {
      settleRetry(db, dispatchId, 'failed', { detail: why })
      escalateFailedRetry(db, dispatchId, why)
    } catch (inner) {
      console.warn('[orchestration] worker retry failed twice', dispatchId, inner)
    }
  }
}

/** What the restarted worker is told: why, and the Task it was given, unchanged. */
export function retryBrief(attempt: number, reason: string, spec: string): string {
  const lines = [
    `Orca restarted you automatically (retry ${attempt}) because your previous attempt ended: ${reason}.`,
    'Check what is already done in this workspace, then continue the Task below and report as you were told to.'
  ]
  if (spec) {
    lines.push('', 'The Task as it was first given:', '', spec)
  }
  return lines.join('\n')
}
