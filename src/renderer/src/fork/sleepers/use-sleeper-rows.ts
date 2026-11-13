// Sleepers (FORK.md): the dialog's rows. Reads the host's list while the dialog is open (again
// every few seconds and after each action) and lays the renderer's own facts over it.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { readForkSleepersPinned, type SleeperRow } from '../../../../shared/fork/sleepers'
import type { ForkSleepersListResult } from '../../../../shared/fork/sleepers-wire'
import { onScreenChatSessionIds } from '../chat-sleep/chat-sleep-view'
import { fetchSleepers } from './sleepers-actions'
import { mergeSleeperRows, sleeperMemoryByPaneKey } from './sleepers-view-model'

/** How often an open dialog reads the host again. Only while it is open. */
const REFRESH_MS = 5_000

export function useSleeperRows(open: boolean): {
  rows: SleeperRow[] | null
  /** The host's clock at the last read, so ages stay steady between reads. */
  now: number
  error: string | null
  refresh: () => void
} {
  const [reply, setReply] = useState<ForkSleepersListResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    if (!open) {
      setReply(null)
      return
    }
    let live = true
    const read = (): void => {
      fetchSleepers()
        .then((next) => {
          if (live) {
            setReply(next)
            setError(null)
          }
        })
        .catch((failure: unknown) => {
          if (live) {
            setError(failure instanceof Error ? failure.message : String(failure))
          }
        })
    }
    read()
    const timer = setInterval(read, REFRESH_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [open, tick])

  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const groupsByWorktree = useAppStore((s) => s.groupsByWorktree)
  const unifiedTabsByWorktree = useAppStore((s) => s.unifiedTabsByWorktree)
  const pinnedSetting = useAppStore((s) => s.settings?.forkSleepersPinned)
  const memorySnapshot = useAppStore((s) => s.memorySnapshot)
  const sleepingRecords = useAppStore((s) => s.sleepingAgentSessionsByPaneKey)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)

  const rows = useMemo(() => {
    if (!reply) {
      return null
    }
    const names = new Map<string, string>()
    for (const worktrees of Object.values(worktreesByRepo ?? {})) {
      for (const worktree of worktrees ?? []) {
        names.set(worktree.id, worktree.displayName)
      }
    }
    return mergeSleeperRows(reply.rows, {
      now: reply.now,
      onScreenChatIds: new Set(
        onScreenChatSessionIds({ activeWorktreeId, groupsByWorktree, unifiedTabsByWorktree })
      ),
      pinned: new Set(readForkSleepersPinned({ forkSleepersPinned: pinnedSetting })),
      memoryByPaneKey: sleeperMemoryByPaneKey(memorySnapshot),
      sleepingRecords: sleepingRecords ?? {},
      workspaceName: (worktreeId) => names.get(worktreeId) ?? worktreeId
    })
  }, [
    reply,
    activeWorktreeId,
    groupsByWorktree,
    unifiedTabsByWorktree,
    pinnedSetting,
    memorySnapshot,
    sleepingRecords,
    worktreesByRepo
  ])

  return { rows, now: reply?.now ?? 0, error, refresh }
}
