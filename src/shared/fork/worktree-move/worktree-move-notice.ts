// SLRM-2265 hardening: what a move copies beyond the committed branch, said before it runs. The
// CLI dry run and the desktop dialog both show it; the sentences are fixed, the names are listed.
import { stripWorktreeMoveControlChars } from './worktree-move-ref'
import type { WorktreeMoveInspectResult } from './worktree-move-wire'

export const WORKTREE_MOVE_TRANSCRIPTS_NOTICE =
  'Full chat transcripts of the carried chats are copied to the target.'
export const WORKTREE_MOVE_UNTRACKED_NOTICE =
  'Untracked files that are not ignored are copied to the target with the uncommitted changes.'

/** The untracked files a patch carries, with control characters removed, and how many were cut. */
export function worktreeMoveUntrackedNames(
  source: Pick<WorktreeMoveInspectResult, 'untracked' | 'untrackedCount'>
): { names: string[]; more: number } {
  const names = (source.untracked ?? []).map(stripWorktreeMoveControlChars)
  return {
    names,
    more: Math.max(0, (source.untrackedCount ?? names.length) - names.length)
  }
}
