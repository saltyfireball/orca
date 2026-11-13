// SLRM-2096: pull request state by branch, read once per repo through the hosting CLI. Without the
// CLI, a login or a GitHub remote the lookup returns null and the scan carries on without it.
import type { LostWorkPullRequest } from '../../../shared/fork/lost-work'

export type LostWorkBranchPullRequest = LostWorkPullRequest & { headOid: string; updatedAt: number }
export type LostWorkPullRequestMap = Map<string, LostWorkBranchPullRequest>

export type LostWorkPullRequestLookup = (
  repo: { path: string; ghAccount?: { host: string; user: string } },
  limit: number,
  signal?: AbortSignal
) => Promise<LostWorkPullRequestMap | null>

export const LOST_WORK_PR_LIST_FIELDS =
  'number,state,url,headRefName,headRefOid,updatedAt,isCrossRepository'

const STATES: Record<string, LostWorkPullRequest['state']> = {
  OPEN: 'open',
  MERGED: 'merged',
  CLOSED: 'closed'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** One pull request per branch: an open one first, else the most recently updated. */
export function parseLostWorkPullRequests(json: string): LostWorkPullRequestMap | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) {
    return null
  }
  const byBranch: LostWorkPullRequestMap = new Map()
  for (const entry of parsed) {
    // A pull request from another fork can share a local branch's name without being its work.
    if (!isRecord(entry) || entry.isCrossRepository === true) {
      continue
    }
    const state = typeof entry.state === 'string' ? STATES[entry.state] : undefined
    const { number, url, headRefName, headRefOid } = entry
    if (
      !state ||
      typeof number !== 'number' ||
      typeof url !== 'string' ||
      !url.startsWith('https://') ||
      typeof headRefName !== 'string' ||
      typeof headRefOid !== 'string'
    ) {
      continue
    }
    const updatedAt = typeof entry.updatedAt === 'string' ? Date.parse(entry.updatedAt) || 0 : 0
    const next = { number, state, url, headOid: headRefOid, updatedAt }
    const current = byBranch.get(headRefName)
    const nextWins =
      !current ||
      (next.state === 'open' && current.state !== 'open') ||
      ((next.state === 'open') === (current.state === 'open') && next.updatedAt > current.updatedAt)
    if (nextWins) {
      byBranch.set(headRefName, next)
    }
  }
  return byBranch
}

export function lostWorkPullRequestArgs(limit: number): string[] {
  return [
    'pr',
    'list',
    '--state',
    'all',
    '--limit',
    String(limit),
    '--json',
    LOST_WORK_PR_LIST_FIELDS
  ]
}
