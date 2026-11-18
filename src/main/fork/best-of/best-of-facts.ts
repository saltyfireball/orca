// Best of N (FORK.md, SLRM-2393): what this machine knows of each attempt now. The worker and its
// task come from the orchestration database (a worker on a paired server is mirrored there with
// its server and remote worktree); the cost comes from the usage ledger (SLRM-2103), which counts
// native Claude chats on this machine only.
import { parseForkBestOfChecks, type ForkBestOfAttempt } from '../../../shared/fork/best-of/best-of'
import type {
  ForkBestOfAttemptFacts,
  ForkBestOfCost
} from '../../../shared/fork/best-of/best-of-wire'
import type { ForkUsageReport } from '../../../shared/fork/usage-report'

export type ForkBestOfFactSources = {
  worker: (
    dispatchId: string
  ) => { worktree_id: string | null; state: string; last_error: string | null } | undefined
  federated: (
    dispatchId: string
  ) =>
    | { environment_id: string; environment_name: string; remote_worktree_id: string | null }
    | undefined
  task: (taskId: string) => { status: string; result: string | null } | undefined
  /** The usage report grouped by workspace, or null when the ledger is not running here. */
  usageByWorkspace: () => ForkUsageReport | null
}

function costOf(report: ForkUsageReport | null, worktreeId: string | null): ForkBestOfCost | null {
  const row = worktreeId ? report?.rows.find((entry) => entry.key === worktreeId) : undefined
  return row
    ? {
        costUsd: row.costUsd,
        totalTokens: row.totalTokens,
        subscriptionTokens: row.subscriptionTokens,
        unpricedTokens: row.unpricedTokens
      }
    : null
}

export function forkBestOfFacts(
  attempts: readonly ForkBestOfAttempt[],
  sources: ForkBestOfFactSources
): ForkBestOfAttemptFacts[] {
  let report: ForkUsageReport | null | undefined
  const usage = (): ForkUsageReport | null => {
    if (report === undefined) {
      try {
        report = sources.usageByWorkspace()
      } catch {
        report = null
      }
    }
    return report
  }
  return attempts.map((attempt) => {
    const worker = attempt.dispatchId ? sources.worker(attempt.dispatchId) : undefined
    const federated = attempt.dispatchId ? sources.federated(attempt.dispatchId) : undefined
    const task = attempt.taskId ? sources.task(attempt.taskId) : undefined
    const worktreeId = federated
      ? (federated.remote_worktree_id ?? worker?.worktree_id ?? null)
      : (worker?.worktree_id ?? null)
    const report = task?.result ?? null
    return {
      index: attempt.index,
      worktreeId,
      environmentId: federated?.environment_id ?? null,
      hostLabel: federated?.environment_name ?? null,
      workerState: worker?.state ?? null,
      workerError: worker?.last_error ?? attempt.startError ?? null,
      taskStatus: task?.status ?? null,
      report,
      checks: parseForkBestOfChecks(report),
      cost: federated ? null : costOf(usage(), worktreeId)
    }
  })
}
