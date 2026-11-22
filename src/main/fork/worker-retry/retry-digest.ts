// Worker retry policy (BAD-681, FORK.md): the automatic restarts of this host in a digest window.
import type { ForkDigestRetry } from '../../../shared/fork/worker-retry'
import { parseForkDigestDbTime } from '../digest/digest-tasks'
import { listRetriesSince, type RetryDbHandle } from './retry-store'

export const FORK_DIGEST_MAX_RETRIES = 50

export function readForkDigestRetries(db: RetryDbHandle, since: number): ForkDigestRetry[] {
  const sinceIso = new Date(since).toISOString()
  const title = db.db.prepare('SELECT task_title, display_name FROM tasks WHERE id = ?')
  return listRetriesSince(db, sinceIso, FORK_DIGEST_MAX_RETRIES).map((entry) => {
    const task = title.get(entry.taskId) as
      | { task_title?: string | null; display_name?: string | null }
      | undefined
    return {
      taskId: entry.taskId,
      title: task?.task_title || task?.display_name || entry.taskId,
      attempt: entry.attempt,
      reason: entry.reason,
      status: entry.status,
      at: parseForkDigestDbTime(entry.at) ?? since
    }
  })
}
