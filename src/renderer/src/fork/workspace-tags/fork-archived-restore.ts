// Archive on merge (FORK.md, SLRM-2397): bring an archived workspace back through the stock
// `worktree.restore` path, which checks its branch out again in the same folder.
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { toRuntimeWorktreeSelector } from '@/runtime/rpc/targets/runtime-worktree-selector'
import { forkClaudeWorktreeTarget } from '../claude-account-move/fork-claude-move-actions'

const RESTORE_TIMEOUT_MS = 10 * 60_000

export async function restoreForkArchivedWorktree(worktree: {
  id: string
  displayName: string
  branch: string
}): Promise<boolean> {
  const target = forkClaudeWorktreeTarget(useAppStore.getState(), worktree.id)
  const name = worktree.displayName || worktree.branch
  if (!target) {
    toast.error(
      translate('fork.archiveOnMerge.noHost', '{{name}}: its host is not connected.', { name })
    )
    return false
  }
  try {
    await callRuntimeRpc(
      target,
      'worktree.restore',
      // The project's own setup choice, as a new workspace would get it.
      { worktree: toRuntimeWorktreeSelector(worktree.id), setupDecision: 'inherit' },
      { timeoutMs: RESTORE_TIMEOUT_MS }
    )
    return true
  } catch (error) {
    toast.error(
      translate('fork.archiveOnMerge.restoreFailed', '{{name}} was not restored: {{detail}}', {
        name,
        detail: error instanceof Error ? error.message : String(error)
      })
    )
    return false
  }
}
