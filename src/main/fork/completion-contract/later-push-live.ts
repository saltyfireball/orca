// Completion contract, later push (BAD-676, FORK.md): the live wiring of the watch. The Run home
// reads a local Task's pull request in its workspace, and asks the paired server a Task's worker ran
// on to read it there; `installForkLaterPushWatch` is the hook where the orchestration database opens.
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { addPRRefreshOutcomeObserver } from '../../github/pull-requests/refresh/pr-refresh-coordinator'
import {
  readCompletionContractSettings,
  type CompletionContractSettings
} from '../../../shared/fork/completion-contract'
import type { ForkLaterPushRead } from '../../../shared/fork/completion-contract-wire'
import { boundedForkPairedCall } from '../paired-server-call/paired-server-call'
import { liveGateWorkspace } from './completion-gate-live'
import { readLaterPushHere } from './later-push-read'
import type { LaterPushWatch } from './later-push-store'
import { LaterPushWatcher } from './later-push-watch'

const SERVER_READ_TIMEOUT_MS = 30_000

function isLaterPushRead(value: unknown): value is ForkLaterPushRead {
  const kind = (value as { kind?: unknown } | null)?.kind
  return (
    typeof kind === 'string' &&
    ['pass', 'fail', 'pending', 'closed', 'unreadable', 'gone'].includes(kind)
  )
}

function settingsOf(runtime: OrcaRuntimeService): CompletionContractSettings {
  return readCompletionContractSettings(runtime.requireStore().getSettings() as never)
}

/** The read a paired server does for the Run home: the Task's last worker attachment on this host. */
export function forkLaterPushReadOnServer(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  taskId: string
): Promise<ForkLaterPushRead> {
  const attachment = db.db
    .prepare(
      'SELECT dispatch_id, worktree_id FROM remote_dispatch_attachments WHERE task_id = ? ORDER BY rowid DESC LIMIT 1'
    )
    .get(taskId) as { dispatch_id: string; worktree_id: string | null } | undefined
  if (!attachment) {
    return Promise.resolve({ kind: 'gone', reason: 'no worker of this Task ran on this server' })
  }
  return readLaterPushHere(db, liveGateWorkspace(runtime, db), {
    taskId,
    dispatchId: attachment.dispatch_id,
    worktreeId: attachment.worktree_id,
    outputLines: settingsOf(runtime).outputLines
  })
}

function liveRead(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb
): (watch: LaterPushWatch) => Promise<ForkLaterPushRead> {
  const call = boundedForkPairedCall((environmentId, method, params, timeoutMs) =>
    runtime.callOrchestrationWorkerServer(environmentId, method, params, timeoutMs)
  )
  return async (watch) => {
    if (watch.environmentId) {
      const answer = await call(
        watch.environmentId,
        'fork.completionContract.laterPush',
        { task: watch.taskId },
        SERVER_READ_TIMEOUT_MS
      )
      if (!isLaterPushRead(answer)) {
        return { kind: 'unreadable', reason: 'the server answered with something else' }
      }
      return answer
    }
    return readLaterPushHere(db, liveGateWorkspace(runtime, db), {
      taskId: watch.taskId,
      dispatchId: watch.dispatchId,
      worktreeId: watch.worktreeId,
      outputLines: settingsOf(runtime).outputLines
    })
  }
}

let installed: LaterPushWatcher | null = null

/** From where the orchestration database opens; the newest database wins. */
export function installForkLaterPushWatch(runtime: OrcaRuntimeService, db: OrchestrationDb): void {
  installed?.stop()
  installed = new LaterPushWatcher({
    db,
    settings: () => settingsOf(runtime),
    read: liveRead(runtime, db),
    notify: (handle, type) => runtime.notifyMessageArrived(handle, type),
    observeRefreshes: (listener) =>
      addPRRefreshOutcomeObserver((candidate, outcome) => {
        if (outcome.kind === 'found') {
          listener(candidate.worktreeId, outcome.pr.headSha)
        }
      })
  })
  installed.start()
}
