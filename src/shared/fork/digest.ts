// Digest (SLRM-2388, FORK.md): one summary of a time window across this host and every paired
// server: orchestration tasks that finished or failed, pull requests merged or open, the
// estimated cost from the usage ledger, and the chats waiting on the user. Shared by main, the
// CLI, the desktop dialog and the phone screen.
import { z } from 'zod'
import { forkHttpUrlOrNull } from './server-health'

export type ForkDigestSettings = {
  /** Fork (SLRM-2388): send a digest of finished, failed, merged, cost and waiting work once a day to the notification targets. Off unless true. */
  forkDigest?: boolean
  /** Fork digest: local hour (0 to 23) the daily digest goes out; unset is 8. */
  forkDigestHour?: number
  /** Fork digest: desktop notification with the digest; unset follows forkInboxNotifyDesktop. */
  forkDigestDesktop?: boolean
  /** Fork digest: POST the digest as JSON to the notification webhook (forkInboxNotifyWebhookUrl); unset is on when that address is set. */
  forkDigestWebhook?: boolean
  /** Fork digest: give the digest as JSON on stdin to the notification command (forkInboxNotifyCommand); unset is on when that command is set. Set it in the Settings screen. */
  forkDigestCommand?: boolean
  /** Fork digest: ask the GitHub CLI (gh) for your merged and open pull requests in each project; unset is on. */
  forkDigestPullRequests?: boolean
}

export const FORK_DIGEST_LOCAL_METHOD = 'fork.digest.local'
export const FORK_DIGEST_COLLECT_METHOD = 'fork.digest.collect'
export const FORK_DIGEST_DEFAULT_HOUR = 8
/** Without a last digest, the window is the last day. */
export const FORK_DIGEST_DEFAULT_WINDOW_MS = 24 * 60 * 60_000
/** The longest window a digest reads. */
export const FORK_DIGEST_MAX_WINDOW_MS = 90 * 24 * 60 * 60_000
/** A paired server has this long to answer, its gh calls included. */
export const FORK_DIGEST_SERVER_TIMEOUT_MS = 45_000
/** What the CLI, the dialog and the phone give the whole fan-out. */
export const FORK_DIGEST_CALL_TIMEOUT_MS = 90_000

export const ForkDigestLocalParams = z.object({
  /** Epoch ms where the window starts. */
  since: z.number().int().min(0),
  pullRequests: z.boolean().optional()
})
export type ForkDigestLocalParams = z.infer<typeof ForkDigestLocalParams>

export const ForkDigestCollectParams = z.object({
  /** Epoch ms where the window starts; absent is since the last digest, else the last day. */
  since: z.number().int().min(0).optional()
})
export type ForkDigestCollectParams = z.infer<typeof ForkDigestCollectParams>

export type ForkDigestTask = {
  id: string
  title: string
  status: 'completed' | 'failed'
  /** Epoch ms it finished or failed. */
  at: number
  /** The first part of the task's result, when it reported one. */
  result: string | null
}

export type ForkDigestPullRequest = {
  repo: string
  number: number
  title: string
  url: string
  state: 'merged' | 'open'
  draft: boolean
  /** Merged: when it merged. Open: when it was last updated. */
  at: number
}

export type ForkDigestWaiting = {
  chatId: string
  title: string
  workspace: string
  question: string
  verdict: 'waiting_user' | 'stalled'
  since: number
}

export type ForkDigestCost = {
  /** Local days the ledger adds up: every day the window touches. */
  days: number
  chats: number
  totalTokens: number
  costUsd: number | null
  subscriptionTokens: number
  unpricedTokens: number
}

/** One host's part of a digest, read by that host itself. */
export type ForkDigestSection = {
  tasks: ForkDigestTask[]
  pullRequests: ForkDigestPullRequest[]
  waiting: ForkDigestWaiting[]
  /** Null where no usage ledger runs (a headless server). */
  cost: ForkDigestCost | null
  /** What could not be read here, said plainly. */
  notes: string[]
}

export type ForkDigestHostStatus = 'ok' | 'unreachable' | 'no-digest'

export type ForkDigestHost = {
  /** 'local' or 'runtime:<environment id>'. */
  hostKey: string
  name: string
  status: ForkDigestHostStatus
  section: ForkDigestSection | null
}

export type ForkDigestTotals = {
  finished: number
  failed: number
  merged: number
  open: number
  waiting: number
  costUsd: number | null
  totalTokens: number
}

export type ForkDigest = {
  since: number
  until: number
  hosts: ForkDigestHost[]
  /** Paired servers this desktop's server health sees as not answering. */
  serversDown: { name: string; downSince: number }[]
  totals: ForkDigestTotals
}

export const FORK_DIGEST_HOUR_CHOICES: readonly number[] = Array.from({ length: 24 }, (_, i) => i)

type SourceKey = keyof ForkDigestSettings | 'forkInboxNotifyDesktop' | 'forkInboxNotifyWebhookUrl'
type Source = Partial<Record<SourceKey | 'forkInboxNotifyCommand', unknown>> | null | undefined

export type ForkDigestConfig = {
  enabled: boolean
  hour: number
  pullRequests: boolean
  desktop: boolean
  webhookUrl: string | null
  command: string | null
}

/** The digest's switches; the address and command are the Decision inbox's (SLRM-2208). */
export function readForkDigestConfig(settings: Source): ForkDigestConfig {
  const hour = settings?.forkDigestHour
  const rawCommand = settings?.forkInboxNotifyCommand
  const command = typeof rawCommand === 'string' && rawCommand.trim() ? rawCommand.trim() : null
  const url = forkHttpUrlOrNull(settings?.forkInboxNotifyWebhookUrl)
  return {
    enabled: settings?.forkDigest === true,
    hour:
      typeof hour === 'number' && Number.isInteger(hour) && hour >= 0 && hour <= 23
        ? hour
        : FORK_DIGEST_DEFAULT_HOUR,
    pullRequests: settings?.forkDigestPullRequests !== false,
    desktop: (settings?.forkDigestDesktop ?? settings?.forkInboxNotifyDesktop) === true,
    webhookUrl: settings?.forkDigestWebhook === false ? null : url,
    command: settings?.forkDigestCommand === false ? null : command
  }
}

/** Today's send time at `hour`, local; the daily digest is due once `now` passes it. */
export function forkDigestScheduledAt(now: number, hour: number): number {
  const at = new Date(now)
  at.setHours(hour, 0, 0, 0)
  return at.getTime()
}

/** True when today's digest time has passed and no digest went out since then. */
export function forkDigestDue(now: number, hour: number, lastSentAt: number | null): boolean {
  const scheduled = forkDigestScheduledAt(now, hour)
  return now >= scheduled && (lastSentAt === null || lastSentAt < scheduled)
}

/** Where a window starts: the caller's time, else the last digest, else a day ago; at most 90 days. */
export function forkDigestWindowStart(
  now: number,
  requested: number | undefined,
  lastSentAt: number | null
): number {
  const start = requested ?? lastSentAt ?? now - FORK_DIGEST_DEFAULT_WINDOW_MS
  return Math.min(now, Math.max(start, now - FORK_DIGEST_MAX_WINDOW_MS))
}

/** The local calendar days from `since` to `now`, both included (the usage ledger keeps days). */
export function forkDigestLedgerDays(since: number, now: number): number {
  const first = new Date(since)
  first.setHours(0, 0, 0, 0)
  const last = new Date(now)
  last.setHours(0, 0, 0, 0)
  return Math.max(1, Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1)
}

const DURATION = /^(\d{1,4})\s*(m|min|h|d|w)$/i
const UNIT_MS: Record<string, number> = {
  m: 60_000,
  min: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000
}

/** `--since`: a duration back from now (90m, 12h, 2d, 1w) or a date and time; else null. */
export function parseForkDigestSince(text: string, now: number): number | null {
  const value = text.trim()
  const duration = DURATION.exec(value)
  if (duration) {
    return now - Number(duration[1]) * UNIT_MS[duration[2].toLowerCase()]
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return null
  }
  const at = Date.parse(value)
  return Number.isFinite(at) && at <= now ? at : null
}

export function totalForkDigest(hosts: readonly ForkDigestHost[]): ForkDigestTotals {
  const totals: ForkDigestTotals = {
    finished: 0,
    failed: 0,
    merged: 0,
    open: 0,
    waiting: 0,
    costUsd: null,
    totalTokens: 0
  }
  const seenUrls = new Set<string>()
  for (const host of hosts) {
    const section = host.section
    if (!section) {
      continue
    }
    for (const task of section.tasks) {
      totals[task.status === 'completed' ? 'finished' : 'failed'] += 1
    }
    for (const pr of section.pullRequests) {
      // A project cloned on two machines lists the same pull request twice.
      if (!seenUrls.has(pr.url)) {
        seenUrls.add(pr.url)
        totals[pr.state] += 1
      }
    }
    totals.waiting += section.waiting.length
    if (section.cost) {
      totals.totalTokens += section.cost.totalTokens
      if (section.cost.costUsd !== null) {
        totals.costUsd = (totals.costUsd ?? 0) + section.cost.costUsd
      }
    }
  }
  return totals
}
