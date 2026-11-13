// Fork sync status (FORK.md "Sync status"). The fork-sync workflow publishes status.json on its
// status branch on every run; the update check reads it so a fork that fell behind upstream, or
// whose last sync failed, says so where update state is shown. Informational only.
import type { ForkGlobalSettings } from './fork-global-settings'
import { FORK_RELEASE_REPO } from './fork-release-repo'

/** Keep in sync with FORK_SYNC_STATUS_BRANCH in .github/workflows/fork-sync.yml. */
export const FORK_SYNC_STATUS_BRANCH = 'fork-sync-status'

/** Derived from the same repo constant the fork's update check uses, so a fork of the fork follows it. */
export const FORK_SYNC_STATUS_URL = `https://raw.githubusercontent.com/${FORK_RELEASE_REPO}/${FORK_SYNC_STATUS_BRANCH}/status.json`

const RUN_URL_PREFIX = `https://github.com/${FORK_RELEASE_REPO}/actions/runs/`

export const FORK_SYNC_STATUS_CHANNELS = {
  /** renderer -> main (invoke): the published status, or null when it cannot be read. */
  get: 'fork:syncStatus:get'
} as const

export type ForkSyncState = 'in-sync' | 'behind' | 'conflict' | 'error'

export type ForkSyncStatus = {
  state: ForkSyncState
  reason: string | null
  upstreamVersion: string | null
  forkBaseVersion: string | null
  conflicts: string[]
  /** ISO time of the first run in the current not-in-sync streak; null when in sync. */
  since: string | null
  /** The run's page, only when it is a run of the fork's own repo. */
  runUrl: string | null
  /** ISO time the workflow wrote this status. */
  checkedAt: string
}

export type ForkSyncStatusApi = {
  get: () => Promise<ForkSyncStatus | null>
}

const STATES: readonly ForkSyncState[] = ['in-sync', 'behind', 'conflict', 'error']
const MAX_TEXT = 300
const MAX_CONFLICTS = 50

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, MAX_TEXT) : null
}

function isoTime(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
}

/** The status from untrusted JSON; null for anything that is not schema 1 with a known state. */
export function parseForkSyncStatus(raw: unknown): ForkSyncStatus | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const value = raw as Record<string, unknown>
  const state = STATES.find((known) => known === value.state)
  const checkedAt = isoTime(value.checkedAt)
  if (value.schema !== 1 || !state || !checkedAt) {
    return null
  }
  const runUrl = text(value.runUrl)
  const conflicts = Array.isArray(value.conflicts)
    ? value.conflicts.map(text).filter((file): file is string => file !== null)
    : []
  return {
    state,
    reason: text(value.reason),
    upstreamVersion: text(value.upstreamVersion),
    forkBaseVersion: text(value.forkBaseVersion),
    conflicts: conflicts.slice(0, MAX_CONFLICTS),
    since: isoTime(value.since),
    runUrl:
      runUrl &&
      runUrl.startsWith(RUN_URL_PREFIX) &&
      /^\d+$/.test(runUrl.slice(RUN_URL_PREFIX.length))
        ? runUrl
        : null,
    checkedAt
  }
}

export const FORK_SYNC_NOTICE_DEFAULT_STALE_DAYS = 3
/** The choices the settings menu offers; 0 never calls a status stale. */
export const FORK_SYNC_NOTICE_STALE_DAY_CHOICES: readonly number[] = [0, 2, 3, 7, 14]
const MAX_STALE_DAYS = 365
const DAY_MS = 24 * 60 * 60 * 1000

type SyncNoticeSettings = Pick<ForkGlobalSettings, 'forkSyncNotice' | 'forkSyncNoticeStaleDays'>

/** The notice is on unless switched off. */
export function forkSyncNoticeEnabled(settings: SyncNoticeSettings | null | undefined): boolean {
  return settings?.forkSyncNotice !== false
}

/** Days without a new status before it is called stale; 0 is off, unset or invalid is 3. */
export function forkSyncNoticeStaleDays(settings: SyncNoticeSettings | null | undefined): number {
  const days = settings?.forkSyncNoticeStaleDays
  return typeof days === 'number' && Number.isInteger(days) && days >= 0 && days <= MAX_STALE_DAYS
    ? days
    : FORK_SYNC_NOTICE_DEFAULT_STALE_DAYS
}

export type ForkSyncNoticeKind = 'behind' | 'conflict' | 'error' | 'stale'

export type ForkSyncNotice = {
  kind: ForkSyncNoticeKind
  status: ForkSyncStatus
  /** Days since the last status, for a stale one. */
  staleDays: number | null
}

/**
 * What to show next to the update state, or null when there is nothing to say. A status the
 * workflow has not refreshed for staleDays is stale whatever it says: GitHub turns off a
 * scheduled workflow in a quiet repo, and then nothing else would ever tell.
 */
export function forkSyncNotice(
  status: ForkSyncStatus | null,
  staleDays: number,
  nowMs: number
): ForkSyncNotice | null {
  if (!status) {
    return null
  }
  const ageDays = Math.floor((nowMs - Date.parse(status.checkedAt)) / DAY_MS)
  if (staleDays > 0 && ageDays >= staleDays) {
    return { kind: 'stale', status, staleDays: ageDays }
  }
  return status.state === 'in-sync' ? null : { kind: status.state, status, staleDays: null }
}
