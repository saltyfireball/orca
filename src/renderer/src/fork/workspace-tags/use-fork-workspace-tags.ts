// Workspace tags (FORK.md, SLRM-2397): the window's read of the tag settings, and the writes.
import { useMemo } from 'react'
import { useAppStore } from '@/store'
import {
  forkWorkspaceTagKey,
  nextTagFilter,
  readForkWorkspaceTagSettings,
  withWorkspaceTags,
  type ForkWorkspaceTagSettings
} from '../../../../shared/fork/workspace-tags'

export function useForkWorkspaceTagSettings(): ForkWorkspaceTagSettings {
  const enabled = useAppStore((s) => s.settings?.forkWorkspaceTagsEnabled)
  const tags = useAppStore((s) => s.settings?.forkWorkspaceTags)
  const filter = useAppStore((s) => s.settings?.forkWorkspaceTagFilter)
  const archiveOnMerge = useAppStore((s) => s.settings?.forkArchiveOnMerge)
  return useMemo(
    () =>
      readForkWorkspaceTagSettings({
        forkWorkspaceTagsEnabled: enabled,
        forkWorkspaceTags: tags,
        forkWorkspaceTagFilter: filter,
        forkArchiveOnMerge: archiveOnMerge
      }),
    [enabled, tags, filter, archiveOnMerge]
  )
}

export function readForkWorkspaceTagsNow(): ForkWorkspaceTagSettings {
  return readForkWorkspaceTagSettings(useAppStore.getState().settings)
}

export function saveForkWorkspaceTags(
  worktree: { id: string; hostId?: string | null },
  tags: readonly string[]
): void {
  const state = useAppStore.getState()
  const current = readForkWorkspaceTagSettings(state.settings)
  const key = forkWorkspaceTagKey(worktree.id, worktree.hostId)
  const next = withWorkspaceTags(current.tags, key, tags)
  // A filter on a tag nobody carries any more would hide nothing or everything; drop it.
  const filterTag = current.filter?.tag
  const filterGone =
    filterTag !== undefined && !Object.values(next).some((list) => list.includes(filterTag))
  void state.updateSettings({
    forkWorkspaceTags: next,
    ...(filterGone ? { forkWorkspaceTagFilter: null } : {})
  })
}

/** A click on a tag chip: show only that tag, then hide it, then no filter. */
export function cycleForkTagFilter(tag: string): void {
  const state = useAppStore.getState()
  const current = readForkWorkspaceTagSettings(state.settings).filter
  void state.updateSettings({ forkWorkspaceTagFilter: nextTagFilter(current, tag) })
}

export function clearForkTagFilter(): void {
  void useAppStore.getState().updateSettings({ forkWorkspaceTagFilter: null })
}
