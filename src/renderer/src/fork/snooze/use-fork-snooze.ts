// Snooze (FORK.md, SLRM-2269): the sidebar's reads. Each returns a stable value while nothing
// snoozed changes, so the sidebar's memoized lists only recompute on a real change.
import { useMemo, useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import {
  forkSnoozeWorkspaceKey,
  readForkSnoozeSettings,
  type ForkSnoozeEntry,
  type ForkSnoozeSettings
} from '../../../../shared/fork/snooze'
import { readForkSnoozeEntries, subscribeForkSnooze } from './snooze-client'

const NONE: ReadonlySet<string> = new Set()

export function useForkSnoozeEntries(): readonly ForkSnoozeEntry[] {
  return useSyncExternalStore(subscribeForkSnooze, readForkSnoozeEntries, readForkSnoozeEntries)
}

export function useForkSnoozeSettings(): ForkSnoozeSettings {
  const settings = useAppStore((s) => s.settings)
  return useMemo(() => readForkSnoozeSettings(settings), [settings])
}

function useEnabled(): boolean {
  return useAppStore((s) => readForkSnoozeSettings(s.settings).enabled)
}

/** Workspace keys (host and id) that are snoozed; empty while snooze is off. */
export function useForkSnoozedWorktreeKeys(): ReadonlySet<string> {
  const entries = useForkSnoozeEntries()
  const enabled = useEnabled()
  return useMemo(() => {
    const keys = entries.flatMap((entry) =>
      entry.target.kind === 'workspace'
        ? [forkSnoozeWorkspaceKey(entry.target.worktreeId, entry.target.hostId)]
        : []
    )
    return enabled && keys.length > 0 ? new Set(keys) : NONE
  }, [entries, enabled])
}

/** The list without snoozed workspaces; the same array when none of them is snoozed. */
export function forkWithoutSnoozedWorktrees<W extends { id: string; hostId?: string | null }>(
  worktrees: W[],
  snoozed: ReadonlySet<string>
): W[] {
  if (snoozed.size === 0) {
    return worktrees
  }
  const kept = worktrees.filter((w) => !snoozed.has(forkSnoozeWorkspaceKey(w.id, w.hostId)))
  return kept.length === worktrees.length ? worktrees : kept
}

/** Agent row keys without snoozed chats; the same array when none of them is snoozed. */
export function useForkWithoutSnoozedPanes(paneKeys: readonly string[]): readonly string[] {
  const entries = useForkSnoozeEntries()
  const enabled = useEnabled()
  return useMemo(() => {
    if (!enabled || entries.length === 0) {
      return paneKeys
    }
    const snoozed = new Set(
      entries.flatMap((entry) => (entry.target.kind === 'chat' ? [entry.target.paneKey] : []))
    )
    const kept = paneKeys.filter((key) => !snoozed.has(key))
    return kept.length === paneKeys.length ? paneKeys : kept
  }, [paneKeys, entries, enabled])
}
