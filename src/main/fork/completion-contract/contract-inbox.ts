// Completion contract (BAD-676, FORK.md): Tasks whose done checks failed past their rounds, as
// Decision inbox rows. Installed from the one hook where the orchestration database opens, so the
// rows return after a restart. A row leaves when its Task completes or when it is dismissed. A
// later push that went red after the Task settled is a row too, until it is dismissed.
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { ForkIdleRecoveryInboxItem } from '../../../shared/fork/idle-recovery-wire'
import { RESULT_CHECK } from '../../../shared/fork/completion-contract'
import {
  notifyForkInboxSourceChanged,
  registerForkInboxSource
} from '../idle-recovery/idle-recovery-sources'
import { clearEscalation, listAttempts, listEscalated } from './contract-store'
import { listInboxWatches, updateWatch } from './later-push-store'
import {
  listReviewEscalated,
  listReviewRuns,
  setReviewEscalated
} from '../reviewer-gate/reviewer-store'
import { forkResultSchemaUseDb } from './result-schema-live'

const ROW_PREFIX = 'contract:'
const PUSH_ROW_PREFIX = 'contract-push:'
const REVIEW_ROW_PREFIX = 'contract-review:'

type TaskReader = { db: OrchestrationDb['db']; taskStatus: (taskId: string) => string | null }

/** A settled Task whose pull request went red on a later push (later-push-watch.ts). */
function laterPushItems(db: TaskReader): ForkIdleRecoveryInboxItem[] {
  return listInboxWatches(db).map((watch) => {
    const last = listAttempts(db, watch.taskId).at(-1)
    return {
      chatId: `${PUSH_ROW_PREFIX}${watch.taskId}`,
      kind: 'chat',
      agent: '',
      title: `Task ${watch.taskId}`,
      workspace: '',
      worktreeId: null,
      verdict: 'stalled',
      question: '',
      reason: `Pull request #${watch.prNumber ?? '?'} went red at ${(watch.notifiedHead ?? '').slice(0, 10)} after the Task settled. The Task was not reopened: start a fix as a new Task. Details: orca contract show ${watch.taskId}`,
      since: last ? Date.parse(`${last.at.replace(' ', 'T')}Z`) || Date.now() : Date.now(),
      wakes: 0,
      wakeAt: null,
      paused: false,
      source: 'contract'
    }
  })
}

export function contractInboxItems(db: TaskReader): ForkIdleRecoveryInboxItem[] {
  return [...escalatedItems(db), ...reviewEscalatedItems(db), ...laterPushItems(db)]
}

/** A Task whose review escalated (BAD-820): the reviewer could not run, or findings outlasted the rounds. */
function reviewEscalatedItems(db: TaskReader): ForkIdleRecoveryInboxItem[] {
  return listReviewEscalated(db).flatMap((taskId): ForkIdleRecoveryInboxItem[] => {
    const status = db.taskStatus(taskId)
    if (status === null || status === 'completed') {
      return []
    }
    const last = listReviewRuns(db, taskId).at(-1)
    const why =
      last?.status === 'error'
        ? `reviewer could not run: ${last.output.split('\n')[0]?.trim() || 'it gave no verdict'}`
        : 'the review still has findings after its rounds'
    return [
      {
        chatId: `${REVIEW_ROW_PREFIX}${taskId}`,
        kind: 'chat',
        agent: '',
        title: `Task ${taskId}`,
        workspace: '',
        worktreeId: null,
        verdict: 'stalled',
        question: '',
        reason: `The worker is done but ${why}. The Task is still open and its worker was told to wait: accept it with task-update or re-dispatch it. Details: orca contract show ${taskId}`,
        since: last
          ? Date.parse(`${(last.finishedAt ?? last.startedAt).replace(' ', 'T')}Z`) || Date.now()
          : Date.now(),
        wakes: 0,
        wakeAt: null,
        paused: false,
        source: 'contract'
      }
    ]
  })
}

function escalatedItems(db: TaskReader): ForkIdleRecoveryInboxItem[] {
  return listEscalated(db).flatMap((taskId): ForkIdleRecoveryInboxItem[] => {
    const status = db.taskStatus(taskId)
    if (status === null || status === 'completed') {
      return []
    }
    const attempts = listAttempts(db, taskId)
    const last = attempts.at(-1)
    const failed = last?.results.filter((result) => !result.ok).map((result) => result.check) ?? []
    return [
      {
        chatId: `${ROW_PREFIX}${taskId}`,
        kind: 'chat',
        agent: '',
        title: `Task ${taskId}`,
        workspace: '',
        worktreeId: null,
        verdict: 'stalled',
        question: '',
        reason: `The worker's done checks${failed.includes(RESULT_CHECK) ? ' or result' : ''} kept failing (${failed.join(', ') || 'see orca contract show'}). The Task is still open: re-dispatch it or accept it with task-update. Details: orca contract show ${taskId}`,
        since: last ? Date.parse(`${last.at.replace(' ', 'T')}Z`) || Date.now() : Date.now(),
        wakes: 0,
        wakeAt: null,
        paused: false,
        source: 'contract'
      }
    ]
  })
}

/** Idempotent; the newest database wins (there is one per runtime). */
export function installForkContractInboxSource(db: OrchestrationDb): void {
  forkResultSchemaUseDb(db)
  registerForkInboxSource({
    id: 'contract',
    items: async () =>
      contractInboxItems({ db: db.db, taskStatus: (id) => db.getTask(id)?.status ?? null }),
    // A row is not a chat: nothing is sent anywhere from it.
    answer: async () => null,
    dismiss: async (chatId) => {
      if (chatId.startsWith(PUSH_ROW_PREFIX)) {
        updateWatch(db, chatId.slice(PUSH_ROW_PREFIX.length), { inbox: false })
        return true
      }
      if (chatId.startsWith(REVIEW_ROW_PREFIX)) {
        setReviewEscalated(db, chatId.slice(REVIEW_ROW_PREFIX.length), false)
        return true
      }
      if (!chatId.startsWith(ROW_PREFIX)) {
        return false
      }
      clearEscalation(db, chatId.slice(ROW_PREFIX.length))
      return true
    }
  })
}

export { notifyForkInboxSourceChanged as notifyContractInboxChanged }
