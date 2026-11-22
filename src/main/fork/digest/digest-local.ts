// Digest (SLRM-2388, FORK.md): this host's own part of a digest. Each source is read on its own; a
// source that fails leaves its list empty and adds a note, so one broken source never hides the rest.
import type {
  ForkDigestCost,
  ForkDigestLocalParams,
  ForkDigestPullRequest,
  ForkDigestSection,
  ForkDigestTask,
  ForkDigestWaiting
} from '../../../shared/fork/digest'
import type { ForkDigestRetry } from '../../../shared/fork/worker-retry'
import { forkDigestLedgerDays } from '../../../shared/fork/digest'
import type { ForkIdleRecoveryInboxResult } from '../../../shared/fork/idle-recovery-wire'
import type { ForkUsageReport } from '../../../shared/fork/usage-report'

export type ForkDigestLocalDeps = {
  now: () => number
  /** Null when this host has no orchestration database. */
  tasks: (since: number) => ForkDigestTask[] | null
  pullRequests: (
    since: number
  ) => Promise<{ pullRequests: ForkDigestPullRequest[]; skipped: number }>
  inbox: () => Promise<ForkIdleRecoveryInboxResult>
  /** BAD-681: automatic worker restarts since a time; absent where none are read. */
  retries?: (since: number) => ForkDigestRetry[]
  /** BAD-685: this host's pause-all switch. */
  paused?: () => { engaged: boolean; since: number | null; corrupt: boolean }
  /** Throws where no usage ledger runs. */
  usage: (days: number) => ForkUsageReport
}

function waitingOf(inbox: ForkIdleRecoveryInboxResult): ForkDigestWaiting[] {
  return inbox.items
    .filter((item) => !item.paused)
    .map((item) => ({
      chatId: item.chatId,
      title: item.title,
      workspace: item.workspace,
      question: item.question || item.reason,
      verdict: item.verdict,
      ...(item.source === 'babysit' ? { source: item.source } : {}),
      since: item.since
    }))
}

function costOf(report: ForkUsageReport, days: number): ForkDigestCost {
  const total = report.total
  return {
    days,
    chats: total.chats,
    totalTokens: total.totalTokens,
    costUsd: total.costUsd,
    subscriptionTokens: total.subscriptionTokens,
    unpricedTokens: total.unpricedTokens
  }
}

export async function readForkDigestLocal(
  deps: ForkDigestLocalDeps,
  params: ForkDigestLocalParams
): Promise<ForkDigestSection> {
  const { since } = params
  const notes: string[] = []
  let tasks: ForkDigestTask[] = []
  try {
    tasks = deps.tasks(since) ?? []
  } catch {
    notes.push('The orchestration tasks could not be read.')
  }
  let retries: ForkDigestRetry[] = []
  try {
    retries = deps.retries?.(since) ?? []
  } catch {
    notes.push('The worker retries could not be read.')
  }
  let pullRequests: ForkDigestPullRequest[] = []
  if (params.pullRequests !== false) {
    try {
      const read = await deps.pullRequests(since)
      pullRequests = read.pullRequests
      if (read.skipped > 0) {
        notes.push(
          `${read.skipped} project${read.skipped === 1 ? '' : 's'} had no pull requests to read (no gh, no login, or not on GitHub).`
        )
      }
    } catch {
      notes.push('The pull requests could not be read.')
    }
  }
  let waiting: ForkDigestWaiting[] = []
  try {
    const inbox = await deps.inbox()
    if (inbox.mode === 'off') {
      notes.push(
        'Idle recovery is off here, so chats that ended on a question are not listed; guard pauses and the PR babysitter still are.'
      )
    }
    waiting = waitingOf(inbox)
  } catch {
    notes.push('The Decision inbox could not be read.')
  }
  let cost: ForkDigestCost | null = null
  try {
    const days = forkDigestLedgerDays(since, deps.now())
    cost = costOf(deps.usage(days), days)
  } catch {
    // Only the desktop app keeps a usage ledger; a server's part has no cost, which is not news.
  }
  let paused: { since: number | null; corrupt: boolean } | undefined
  try {
    const pause = deps.paused?.()
    paused = pause?.engaged ? { since: pause.since, corrupt: pause.corrupt } : undefined
  } catch {
    notes.push('The pause-all switch could not be read.')
  }
  return {
    tasks,
    pullRequests,
    waiting,
    ...(retries.length ? { retries } : {}),
    ...(paused ? { paused } : {}),
    cost,
    notes
  }
}
