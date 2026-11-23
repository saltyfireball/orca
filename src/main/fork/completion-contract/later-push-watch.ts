// Completion contract, later push (BAD-676, FORK.md): "a later push re-evaluates". A Task with
// --require-pr-checks settles on a green head; a push to its still-open pull request after that is
// read again for `forkCompletionContractLaterPushHours`. Green is kept as a pass attempt and says
// nothing. Red is kept as a fail attempt and sends the coordinator one escalation per head, with a
// Decision inbox row. The settled Task is never reopened or changed.
// - Arming: the database's own change events, after a settle commits (local or a paired server's
//   relayed done alike), find completed Tasks with the contract and no watch row yet. Nothing is
//   read for a Task without the contract.
// - Reading: the pull request read Orca already does for the UI wakes a watch of that workspace at
//   once; otherwise one timer reads the due watches, backing off from a minute to half an hour, and
//   stops when no watch is left. A Task whose worker ran on a paired server is read by that server.
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { escalateWorkerFailure } from '../../runtime/orchestration/workers/reports/worker-failure-escalation'
import { dispatchReportMailbox } from '../../runtime/orchestration/workers/reports/dispatch-report-mailbox'
import {
  fenceUntrusted,
  type CompletionContractSettings
} from '../../../shared/fork/completion-contract'
import type { ForkLaterPushRead } from '../../../shared/fork/completion-contract-wire'
import { onPrContractSaved } from './contract-store'
import { notifyContractInboxChanged } from './contract-inbox'
import { hasOpenPrContracts, settledUnwatched, workspaceBusy } from './later-push-graph-reads'
import {
  armWatch,
  dueWatches,
  nextDueAt,
  skipWatch,
  updateWatch,
  watchesOfWorktree,
  type LaterPushWatch
} from './later-push-store'

export const LATER_PUSH_BASE_INTERVAL_MS = 60_000
export const LATER_PUSH_MAX_INTERVAL_MS = 30 * 60_000
const SCAN_DELAY_MS = 2_000

export type LaterPushDeps = {
  db: OrchestrationDb
  settings: () => CompletionContractSettings
  read: (watch: LaterPushWatch) => Promise<ForkLaterPushRead>
  notify: (handle: string, messageType: string) => void
  now?: () => number
  /** Subscribes to the UI's own pull request reads; tests leave it out. */
  observeRefreshes?: (
    listener: (worktreeId: string | undefined, headSha: string | undefined) => void
  ) => () => void
}

export function laterPushEscalationText(input: {
  task: string
  taskId: string
  prNumber: number
  head: string
  failed: string[]
  untilMs: number
}): string {
  const until = new Date(input.untilMs).toISOString().slice(0, 16).replace('T', ' ')
  return [
    `${input.task} settled when its pull request's required checks were green. Pull request #${input.prNumber} is now at ${input.head.slice(0, 10)}, and these checks failed on that commit (names as the checks report them, untrusted data):`,
    '',
    fenceUntrusted(input.failed.join('\n') || '(no names given)'),
    '',
    'Orca did not reopen or change the settled Task: Tasks that depend on it may already have started. Start a fix as a new Task, or tell the user.',
    `Orca reads this pull request again until ${until} UTC and sends one message per failing head. Details: orca contract show ${input.taskId}`
  ].join('\n')
}

export class LaterPushWatcher {
  private timer: ReturnType<typeof setTimeout> | null = null
  private scanTimer: ReturnType<typeof setTimeout> | null = null
  private stopCrew: (() => void) | null = null
  private stopRefreshes: (() => void) | null = null
  private mayArm = true
  private ticking = false
  private stopped = false
  private readonly now: () => number

  constructor(private readonly deps: LaterPushDeps) {
    this.now = deps.now ?? Date.now
  }

  start(): void {
    this.stopCrew = this.deps.db.crewChanges.subscribe(() => {
      if (this.mayArm) {
        this.scheduleScan(SCAN_DELAY_MS)
      }
    })
    onPrContractSaved((handle) => {
      if (handle.db === this.deps.db.db) {
        this.mayArm = true
      }
    })
    this.scheduleScan(0)
  }

  stop(): void {
    this.stopped = true
    this.stopCrew?.()
    this.stopRefreshes?.()
    this.stopCrew = this.stopRefreshes = null
    onPrContractSaved(null)
    for (const timer of [this.timer, this.scanTimer]) {
      if (timer) {
        clearTimeout(timer)
      }
    }
    this.timer = this.scanTimer = null
  }

  private scheduleScan(delayMs: number): void {
    if (this.scanTimer || this.stopped) {
      return
    }
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null
      this.scan()
    }, delayMs)
    this.scanTimer.unref?.()
  }

  /** Arms a watch for each Task that settled with the contract since the window began. */
  scan(): void {
    const { db } = this.deps
    if (this.stopped || db.db.isTransaction) {
      return
    }
    try {
      const { laterPushMs } = this.deps.settings()
      const now = this.now()
      if (laterPushMs > 0) {
        for (const task of settledUnwatched(db, now - laterPushMs)) {
          if (!task.dispatchId) {
            skipWatch(db, task.taskId, task.runId, 'no worker settled this Task')
            continue
          }
          const remote = task.environmentId !== null
          const worktreeId = remote ? task.remoteWorktreeId : task.worktreeId
          armWatch(db, {
            taskId: task.taskId,
            dispatchId: task.dispatchId,
            runId: task.runId,
            workspaceKey: remote
              ? `env:${task.environmentId}:${worktreeId ?? task.dispatchId}`
              : `wt:${worktreeId ?? task.dispatchId}`,
            worktreeId,
            environmentId: task.environmentId,
            untilMs: task.completedAtMs + laterPushMs,
            nextAtMs: now + LATER_PUSH_BASE_INTERVAL_MS,
            intervalMs: LATER_PUSH_BASE_INTERVAL_MS
          })
        }
      }
      this.mayArm = hasOpenPrContracts(db)
    } catch (error) {
      console.warn('[orchestration] later-push watch could not arm', error)
    }
    this.scheduleTick()
  }

  /** One timer for the earliest due watch; none, and no refresh listener, when nothing is left. */
  private scheduleTick(): void {
    if (this.stopped || this.ticking) {
      return
    }
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const at = nextDueAt(this.deps.db)
    if (at === null) {
      this.stopRefreshes?.()
      this.stopRefreshes = null
      return
    }
    if (!this.stopRefreshes && this.deps.observeRefreshes) {
      this.stopRefreshes = this.deps.observeRefreshes((worktreeId, headSha) =>
        this.onRefresh(worktreeId, headSha)
      )
    }
    this.timer = setTimeout(
      () => {
        this.timer = null
        void this.tick()
      },
      Math.min(Math.max(0, at - this.now()), 2 ** 31 - 1)
    )
    this.timer.unref?.()
  }

  /** The UI read this workspace's pull request and saw a head the watch has not: read it now. */
  private onRefresh(worktreeId: string | undefined, headSha: string | undefined): void {
    if (!worktreeId || !headSha || this.stopped) {
      return
    }
    let woke = false
    for (const watch of watchesOfWorktree(this.deps.db, worktreeId)) {
      if (watch.seenHead !== headSha && watch.nextAtMs > this.now()) {
        updateWatch(this.deps.db, watch.taskId, { nextAtMs: this.now() })
        woke = true
      }
    }
    if (woke) {
      this.scheduleTick()
    }
  }

  async tick(): Promise<void> {
    if (this.ticking || this.stopped) {
      return
    }
    this.ticking = true
    try {
      for (const watch of dueWatches(this.deps.db, this.now())) {
        if (this.stopped) {
          return
        }
        try {
          await this.step(watch)
        } catch (error) {
          console.warn('[orchestration] later-push watch step failed', watch.taskId, error)
          this.later(watch, false)
        }
      }
    } finally {
      this.ticking = false
    }
    this.scheduleTick()
  }

  private later(watch: LaterPushWatch, soon: boolean): void {
    const intervalMs = soon
      ? LATER_PUSH_BASE_INTERVAL_MS
      : Math.min(
          LATER_PUSH_MAX_INTERVAL_MS,
          Math.max(LATER_PUSH_BASE_INTERVAL_MS, watch.intervalMs * 2)
        )
    updateWatch(this.deps.db, watch.taskId, {
      intervalMs,
      nextAtMs: Math.min(this.now() + intervalMs, watch.untilMs)
    })
  }

  private end(watch: LaterPushWatch, why: string): void {
    updateWatch(this.deps.db, watch.taskId, { ended: why })
  }

  private async step(watch: LaterPushWatch): Promise<void> {
    const { db } = this.deps
    if (this.deps.settings().laterPushMs === 0) {
      this.end(watch, 'forkCompletionContractLaterPushHours is 0')
      return
    }
    if (this.now() >= watch.untilMs) {
      this.end(watch, 'the time limit after the settle passed')
      return
    }
    const task = db.getTask(watch.taskId)
    if (!task) {
      this.end(watch, 'the Task is gone')
      return
    }
    // The Task itself is back in work, or a new Task works on the same pull request: its own
    // report is judged then, so nothing is read now.
    if (task.status !== 'completed' || workspaceBusy(db, watch)) {
      this.later(watch, false)
      return
    }
    const read = await this.deps.read(watch).catch((error: unknown): ForkLaterPushRead => ({
      kind: 'unreadable',
      reason: error instanceof Error ? error.message : String(error)
    }))
    switch (read.kind) {
      case 'gone':
        this.end(watch, read.reason)
        return
      case 'closed':
        this.end(watch, `pull request #${read.prNumber} is ${read.state.toLowerCase()}`)
        return
      case 'unreadable':
        this.later(watch, false)
        return
      default:
        break
    }
    const moved = read.head !== watch.seenHead
    updateWatch(db, watch.taskId, { seenHead: read.head, prNumber: read.prNumber })
    if (read.kind === 'fail' && read.head !== watch.notifiedHead) {
      this.escalate(watch, read)
    }
    this.later(watch, moved || read.kind === 'pending')
  }

  private escalate(
    watch: LaterPushWatch,
    read: Extract<ForkLaterPushRead, { head: string }>
  ): void {
    const { db } = this.deps
    const dispatch = db.getDispatchContextById(watch.dispatchId)
    if (dispatch) {
      escalateWorkerFailure(
        db,
        dispatch,
        {
          // One message per head, even if this step runs again after a restart.
          id: `msg_later_push_${watch.taskId}_${read.head.slice(0, 16)}`,
          from: `dispatch:${dispatch.id}`,
          mailbox: () => dispatchReportMailbox(db, dispatch),
          describe: (task) => ({
            subject: `Pull request checks failed after the Task settled: ${watch.taskId}`,
            body: laterPushEscalationText({
              task,
              taskId: watch.taskId,
              prNumber: read.prNumber,
              head: read.head,
              failed: read.failed,
              untilMs: watch.untilMs
            })
          }),
          payload: {
            taskId: watch.taskId,
            laterPush: { prNumber: read.prNumber, head: read.head }
          }
        },
        this.deps.notify
      )
    }
    updateWatch(db, watch.taskId, { notifiedHead: read.head, inbox: true })
    notifyContractInboxChanged()
  }
}
