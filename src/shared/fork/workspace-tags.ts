// Workspace tags (FORK.md, SLRM-2397): short words on a workspace, a sidebar filter by one tag,
// and archive on merge. Tags live in settings, keyed by workspace id and host, so they survive
// restarts; the filter shows only one tag's workspaces, or hides them.
import { LOCAL_EXECUTION_HOST_ID } from '../execution-host/execution-host'

export type ForkWorkspaceTagFilter = { tag: string; mode: 'only' | 'hide' }

export type ForkWorkspaceTagSettings = {
  enabled: boolean
  tags: Readonly<Record<string, readonly string[]>>
  filter: ForkWorkspaceTagFilter | null
  archiveOnMerge: boolean
}

type TagSettingsSource = {
  forkWorkspaceTagsEnabled?: boolean
  forkWorkspaceTags?: Record<string, string[]>
  forkWorkspaceTagFilter?: ForkWorkspaceTagFilter | null
  forkArchiveOnMerge?: boolean
}

export const MAX_TAGS_PER_WORKSPACE = 8
export const MAX_TAG_LENGTH = 32
const TAG_RE = /^[a-z0-9][a-z0-9_.:/-]*$/

/** One tag as stored: lower case, no spaces; null when the word cannot be a tag. */
export function normalizeTag(word: string): string | null {
  const tag = word.trim().replace(/^#/, '').toLowerCase()
  return tag.length > 0 && tag.length <= MAX_TAG_LENGTH && TAG_RE.test(tag) ? tag : null
}

/** Tags from what the user typed: words split by spaces or commas, deduplicated, at most 8. */
export function parseTags(input: string): string[] {
  const out: string[] = []
  for (const word of input.split(/[\s,]+/)) {
    const tag = normalizeTag(word)
    if (tag && !out.includes(tag)) {
      out.push(tag)
    }
    if (out.length === MAX_TAGS_PER_WORKSPACE) {
      break
    }
  }
  return out
}

/** The settings key of a workspace's tags: its id, on its host when that is not this desktop. */
export function forkWorkspaceTagKey(worktreeId: string, hostId?: string | null): string {
  return hostId && hostId !== LOCAL_EXECUTION_HOST_ID ? `${hostId}|${worktreeId}` : worktreeId
}

function readFilter(value: unknown): ForkWorkspaceTagFilter | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const { tag, mode } = value as Record<string, unknown>
  const normalized = typeof tag === 'string' ? normalizeTag(tag) : null
  return normalized && (mode === 'only' || mode === 'hide') ? { tag: normalized, mode } : null
}

export function readForkWorkspaceTagSettings(
  settings: TagSettingsSource | null | undefined
): ForkWorkspaceTagSettings {
  const raw = settings?.forkWorkspaceTags
  const tags: Record<string, readonly string[]> = {}
  if (raw && typeof raw === 'object') {
    for (const [key, list] of Object.entries(raw)) {
      if (Array.isArray(list)) {
        const clean = parseTags(list.filter((t) => typeof t === 'string').join(' '))
        if (clean.length > 0) {
          tags[key] = clean
        }
      }
    }
  }
  return {
    enabled: settings?.forkWorkspaceTagsEnabled !== false,
    tags,
    filter: readFilter(settings?.forkWorkspaceTagFilter),
    archiveOnMerge: settings?.forkArchiveOnMerge === true
  }
}

/** The settings value after setting one workspace's tags (an empty list removes the entry). */
export function withWorkspaceTags(
  current: Readonly<Record<string, readonly string[]>>,
  key: string,
  tags: readonly string[]
): Record<string, string[]> {
  const next: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(current)) {
    if (k !== key) {
      next[k] = [...v]
    }
  }
  if (tags.length > 0) {
    next[key] = [...tags]
  }
  return next
}

/** The next filter when a tag chip is clicked: show only it, then hide it, then no filter. */
export function nextTagFilter(
  current: ForkWorkspaceTagFilter | null,
  tag: string
): ForkWorkspaceTagFilter | null {
  if (current?.tag !== tag) {
    return { tag, mode: 'only' }
  }
  return current.mode === 'only' ? { tag, mode: 'hide' } : null
}

/** The list under the filter; the same array when the filter keeps everything. */
export function filterByTag<W extends { id: string; hostId?: string | null }>(
  worktrees: W[],
  settings: Pick<ForkWorkspaceTagSettings, 'enabled' | 'tags' | 'filter'>
): W[] {
  const { filter } = settings
  if (!settings.enabled || !filter) {
    return worktrees
  }
  const kept = worktrees.filter((worktree) => {
    const has = (settings.tags[forkWorkspaceTagKey(worktree.id, worktree.hostId)] ?? []).includes(
      filter.tag
    )
    return filter.mode === 'only' ? has : !has
  })
  return kept.length === worktrees.length ? worktrees : kept
}

/** Every tag in use and how many workspaces carry it, most used first. */
export function tagCounts(
  tags: Readonly<Record<string, readonly string[]>>
): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const list of Object.values(tags)) {
    for (const tag of list) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/** What archive on merge knows about one workspace at one look. */
export type ForkArchiveOnMergeFacts = {
  isArchived: boolean
  isMainWorktree: boolean
  hasBranch: boolean
  /** Its pull request shows as merged. */
  merged: boolean
  /** The workspace the user has open now. */
  active: boolean
  /** One of its agents is working, waiting or blocked. */
  busy: boolean
  /** Snoozed until merge: that snooze settles first, so its settle command sees the checkout. */
  snoozedUntilMerge: boolean
  /** When archive on merge last tried it, 0 for never. */
  lastTriedAt: number
}

/** A failed try (dirty files, a running process) waits this long before the next one. */
export const FORK_ARCHIVE_RETRY_MS = 30 * 60_000

export function shouldForkArchiveOnMerge(facts: ForkArchiveOnMergeFacts, now: number): boolean {
  return (
    facts.merged &&
    !facts.isArchived &&
    !facts.isMainWorktree &&
    facts.hasBranch &&
    !facts.active &&
    !facts.busy &&
    !facts.snoozedUntilMerge &&
    now - facts.lastTriedAt >= FORK_ARCHIVE_RETRY_MS
  )
}
