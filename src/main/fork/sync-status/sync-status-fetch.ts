// Reads the fork-sync workflow's published status (FORK.md "Sync status"). Any failure is
// null: the notice is informational and never gets in the way of an update.
import {
  FORK_SYNC_STATUS_URL,
  parseForkSyncStatus,
  type ForkSyncStatus
} from '../../../shared/fork/fork-sync-status'

export type ForkSyncStatusFetch = (
  url: string,
  init: { signal: AbortSignal; cache: 'no-store' }
) => Promise<{ ok: boolean; text: () => Promise<string> }>

const TIMEOUT_MS = 10_000
/** status.json is well under 4 KB; anything past this is not ours. */
const MAX_BYTES = 64 * 1024
/** Each update check asks again; checks closer than this share one read. */
const CACHE_MS = 5 * 60 * 1000

export function createForkSyncStatusReader(
  fetchImpl: ForkSyncStatusFetch,
  now: () => number = Date.now,
  url: string = FORK_SYNC_STATUS_URL
): () => Promise<ForkSyncStatus | null> {
  let cached: { at: number; status: ForkSyncStatus | null } | null = null
  let pending: Promise<ForkSyncStatus | null> | null = null

  async function read(): Promise<ForkSyncStatus | null> {
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store'
      })
      if (!response.ok) {
        return null
      }
      const body = await response.text()
      return body.length > MAX_BYTES ? null : parseForkSyncStatus(JSON.parse(body))
    } catch {
      return null
    }
  }

  return () => {
    if (cached && now() - cached.at < CACHE_MS) {
      return Promise.resolve(cached.status)
    }
    pending ??= read().then((status) => {
      cached = { at: now(), status }
      pending = null
      return status
    })
    return pending
  }
}
