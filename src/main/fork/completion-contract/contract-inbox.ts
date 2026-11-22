// Completion contract (BAD-676, FORK.md): Tasks whose done checks failed past their rounds, as
// Decision inbox rows. Installed from the one hook where the orchestration database opens, so the
// rows return after a restart. A row leaves when its Task completes or when it is dismissed.
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { ForkIdleRecoveryInboxItem } from '../../../shared/fork/idle-recovery-wire'
import {
  notifyForkInboxSourceChanged,
  registerForkInboxSource
} from '../idle-recovery/idle-recovery-sources'
import { clearEscalation, listAttempts, listEscalated } from './contract-store'

const ROW_PREFIX = 'contract:'

type TaskReader = { db: OrchestrationDb['db']; taskStatus: (taskId: string) => string | null }

export function contractInboxItems(db: TaskReader): ForkIdleRecoveryInboxItem[] {
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
        reason: `The worker's done checks kept failing (${failed.join(', ') || 'see orca contract show'}). The Task is still open: re-dispatch it or accept it with task-update. Details: orca contract show ${taskId}`,
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
  registerForkInboxSource({
    id: 'contract',
    items: async () =>
      contractInboxItems({ db: db.db, taskStatus: (id) => db.getTask(id)?.status ?? null }),
    // A row is not a chat: nothing is sent anywhere from it.
    answer: async () => null,
    dismiss: async (chatId) => {
      if (!chatId.startsWith(ROW_PREFIX)) {
        return false
      }
      clearEscalation(db, chatId.slice(ROW_PREFIX.length))
      return true
    }
  })
}

export { notifyForkInboxSourceChanged as notifyContractInboxChanged }
