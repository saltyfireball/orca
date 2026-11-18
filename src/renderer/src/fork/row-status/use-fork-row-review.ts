// SLRM-2390 (FORK.md "Row status"): the pull request an agent row shows, read the way its
// workspace card reads it: the same two cache entries, so the row follows the stock PR watcher
// and never polls on its own.
import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/github/refresh/worktree-refresh'
import {
  deriveWorktreeCardPrDisplay,
  getWorktreeReviewCacheKeys
} from '@/components/sidebar/workspace-card/review/worktree-card-pr-derivation'
import type { WorktreeCardPrDisplay } from '@/components/sidebar/workspace-card/review/worktree-card-pr-display'
import type { Repo } from '../../../../shared/repository/repo-types'

/** The workspace's review (null when it has none or `enabled` is false) and its project. */
export function useForkRowReview(
  worktreeId: string,
  enabled: boolean
): { review: WorktreeCardPrDisplay | null; repo: Repo | undefined } {
  const worktree = useAppStore((s) => (enabled ? findWorktreeById(s, worktreeId) : null))
  const repo = useAppStore((s) =>
    worktree ? s.repos.find((candidate) => candidate.id === worktree.repoId) : undefined
  )
  const settings = useAppStore((s) => (worktree ? s.settings : null))
  const keys = useMemo(
    () => (worktree ? getWorktreeReviewCacheKeys(worktree, repo, settings) : null),
    [worktree, repo, settings]
  )
  const hostedReviewEntry = useAppStore((s) =>
    keys?.hostedReviewCacheKey ? s.hostedReviewCache[keys.hostedReviewCacheKey] : undefined
  )
  const prCacheEntry = useAppStore((s) =>
    keys?.prCacheKey ? s.prCache?.[keys.prCacheKey] : undefined
  )
  const review = useMemo(
    () =>
      worktree
        ? deriveWorktreeCardPrDisplay(worktree, hostedReviewEntry, prCacheEntry).prDisplay
        : null,
    [worktree, hostedReviewEntry, prCacheEntry]
  )
  return { review, repo }
}
