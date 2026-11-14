// SLRM-2230 (FORK.md "Lost work"): lays what is in use over the scan's rows while the dialog is
// open. Use changes without a scan (a chat opens, an agent starts), so it is read again every few
// seconds and once more right before a delete.
import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import { resolveLostWorkSettings, type LostWorkItem } from '../../../../shared/fork/lost-work'
import { annotateLostWorkUse, type LostWorkUse } from '../../../../shared/fork/lost-work-use'
import { lostWorkUseByWorktree } from './lost-work-use-facts'

const REFRESH_MS = 3_000

function worktreeIds(items: readonly LostWorkItem[]): string[] {
  return items.flatMap((item) => (item.worktreeId ? [item.worktreeId] : []))
}

function readUse(items: readonly LostWorkItem[]): [string, LostWorkUse][] {
  const uses = lostWorkUseByWorktree(useAppStore.getState(), worktreeIds(items), Date.now())
  return [...uses].sort(([a], [b]) => a.localeCompare(b))
}

/** The rows as they stand this moment, marked in use by the signals the settings count. */
export function withLostWorkUseNow(items: readonly LostWorkItem[]): LostWorkItem[] {
  const signals = resolveLostWorkSettings(useAppStore.getState().settings?.forkLostWork).inUse
  // Drop an earlier mark first, so a row whose chats closed is no longer held.
  const bare = items.map(({ inUse: _inUse, ...item }) => item)
  return annotateLostWorkUse(bare, new Map(readUse(items)), signals)
}

export function useLostWorkWithUse(items: readonly LostWorkItem[]): LostWorkItem[] {
  const stored = useAppStore((s) => s.settings?.forkLostWork?.inUse)
  // A string, so a read that finds nothing new leaves the rows as they are.
  const [useKey, setUseKey] = useState(() => JSON.stringify(readUse(items)))
  useEffect(() => {
    const read = (): void => setUseKey(JSON.stringify(readUse(items)))
    read()
    return installWindowVisibilityInterval({ run: read, intervalMs: REFRESH_MS })
  }, [items])
  return useMemo(() => {
    const uses = new Map(JSON.parse(useKey) as [string, LostWorkUse][])
    const signals = resolveLostWorkSettings(stored ? { inUse: stored } : undefined).inUse
    return annotateLostWorkUse(items, uses, signals)
  }, [items, useKey, stored])
}
