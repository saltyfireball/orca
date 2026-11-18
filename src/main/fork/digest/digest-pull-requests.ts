// Digest (SLRM-2388, FORK.md): your pull requests in this host's projects, through the GitHub CLI:
// the ones merged in the window and the ones still open. One `gh pr list` per project; without gh,
// a login or a GitHub remote a project is skipped and the digest says how many were.
import { mapWithConcurrency } from '../../../shared/concurrency/map-with-concurrency'
import type { ForkDigestPullRequest } from '../../../shared/fork/digest'

export const FORK_DIGEST_PR_LIMIT = 30
export const FORK_DIGEST_MAX_REPOS = 50
export const FORK_DIGEST_PR_TIMEOUT_MS = 15_000
const CONCURRENCY = 3
const MAX_TITLE_CHARS = 200

export type ForkDigestRepo = {
  name: string
  path: string
  ghAccount?: { host: string; user: string }
}

/** Runs gh in `repo.path` and resolves its stdout; rejects on any failure. */
export type ForkDigestGh = (
  args: string[],
  repo: ForkDigestRepo,
  signal: AbortSignal
) => Promise<string>

export function forkDigestPullRequestArgs(): string[] {
  return [
    'pr',
    'list',
    '--author',
    '@me',
    '--state',
    'all',
    '--limit',
    String(FORK_DIGEST_PR_LIMIT),
    '--json',
    'number,title,url,state,isDraft,mergedAt,updatedAt'
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function time(value: unknown): number | null {
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(at) ? at : null
}

/** The merged-in-window and open pull requests of one `gh pr list` answer; null when unreadable. */
export function parseForkDigestPullRequests(
  json: string,
  repo: string,
  since: number
): ForkDigestPullRequest[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) {
    return null
  }
  const out: ForkDigestPullRequest[] = []
  for (const entry of parsed) {
    if (!isRecord(entry)) {
      continue
    }
    const { number, title, url, state } = entry
    if (
      typeof number !== 'number' ||
      typeof url !== 'string' ||
      !url.startsWith('https://') ||
      typeof title !== 'string'
    ) {
      continue
    }
    const base = {
      repo,
      number,
      title: title.slice(0, MAX_TITLE_CHARS),
      url,
      draft: entry.isDraft === true
    }
    if (state === 'MERGED') {
      const at = time(entry.mergedAt)
      if (at !== null && at >= since) {
        out.push({ ...base, state: 'merged', at })
      }
    } else if (state === 'OPEN') {
      out.push({ ...base, state: 'open', at: time(entry.updatedAt) ?? 0 })
    }
  }
  return out
}

export async function readForkDigestPullRequests(
  repos: readonly ForkDigestRepo[],
  since: number,
  gh: ForkDigestGh
): Promise<{ pullRequests: ForkDigestPullRequest[]; skipped: number }> {
  const byPath = new Map<string, ForkDigestRepo>()
  for (const repo of repos) {
    if (!byPath.has(repo.path)) {
      byPath.set(repo.path, repo)
    }
  }
  const unique = [...byPath.values()].slice(0, FORK_DIGEST_MAX_REPOS)
  const seen = new Set<string>()
  const pullRequests: ForkDigestPullRequest[] = []
  let skipped = 0
  await mapWithConcurrency(unique, CONCURRENCY, async (repo) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FORK_DIGEST_PR_TIMEOUT_MS)
    try {
      const parsed = parseForkDigestPullRequests(
        await gh(forkDigestPullRequestArgs(), repo, controller.signal),
        repo.name,
        since
      )
      if (!parsed) {
        skipped += 1
        return
      }
      for (const pr of parsed) {
        // Two projects on one GitHub repository (two clones) list the same pull requests.
        if (!seen.has(pr.url)) {
          seen.add(pr.url)
          pullRequests.push(pr)
        }
      }
    } catch {
      // No gh, no login, not a GitHub remote, or too slow: this project is left out.
      skipped += 1
    } finally {
      clearTimeout(timer)
    }
  })
  pullRequests.sort((a, b) => b.at - a.at)
  return { pullRequests, skipped }
}
