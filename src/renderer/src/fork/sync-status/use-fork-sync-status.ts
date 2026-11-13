// The fork sync notice for the update section (FORK.md "Sync status"). It reads the published
// status when the section opens and again after each update check settles, so it rides on the
// update check; with the notice off it never reads.
import { useEffect, useState } from 'react'
import {
  forkSyncNotice,
  forkSyncNoticeEnabled,
  forkSyncNoticeStaleDays,
  type ForkSyncNotice,
  type ForkSyncStatus
} from '../../../../shared/fork/fork-sync-status'
import { useNow } from '../../hooks/use-now'
import { useAppStore } from '../../store/index'

const HOUR_MS = 60 * 60 * 1000

/** Update states after which the status is read again; mid-check states are skipped. */
const SETTLED = new Set(['idle', 'not-available', 'available', 'downloaded', 'error'])

export function useForkSyncNotice(updateState: string): ForkSyncNotice | null {
  const enabled = useAppStore((s) => forkSyncNoticeEnabled(s.settings))
  const staleDays = useAppStore((s) => forkSyncNoticeStaleDays(s.settings))
  const [status, setStatus] = useState<ForkSyncStatus | null>(null)
  const settled = SETTLED.has(updateState)

  useEffect(() => {
    const api = window.api.forkSyncStatus
    if (!enabled || !settled || !api) {
      return
    }
    let cancelled = false
    void api
      .get()
      .then((next) => {
        if (!cancelled) {
          setStatus(next)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [enabled, settled, updateState])

  // A coarse shared clock keeps render pure and lets a status turn stale while the pane stays open.
  const now = useNow(HOUR_MS, enabled && status !== null)
  return enabled ? forkSyncNotice(status, staleDays, now) : null
}
