// Snooze (FORK.md, SLRM-2269): open a snoozed workspace or chat the way the sidebar opens it,
// waking it first when "wake when opened" is on.
import { activateAndRevealWorktree } from '@/lib/workspace/activation/worktree-activation'
import { activateWorktreeAgentPane } from '@/components/sidebar/workspace-card/activity/use-worktree-agent-activation'
import { parseExecutionHostId, type ExecutionHostId } from '../../../../shared/execution-host'
import { parsePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'
import type { ForkSnoozeEntry } from '../../../../shared/fork/snooze'
import { wakeForkSnooze } from './snooze-client'

function hostOf(entry: ForkSnoozeEntry): ExecutionHostId | undefined {
  const parsed = parseExecutionHostId(entry.target.hostId)
  return parsed && parsed.kind !== 'local' ? (entry.target.hostId as ExecutionHostId) : undefined
}

export function openForkSnoozedEntry(entry: ForkSnoozeEntry, wakeOnOpen: boolean): void {
  if (wakeOnOpen) {
    void wakeForkSnooze(entry.id, 'opened')
  }
  const { target } = entry
  if (target.kind === 'workspace') {
    activateAndRevealWorktree(target.worktreeId, {
      navigationIntent: 'user-open',
      executionHostId: hostOf(entry)
    })
    return
  }
  const parsed = parsePaneKey(target.paneKey)
  if (target.worktreeId && parsed) {
    activateWorktreeAgentPane(target.worktreeId, parsed.tabId, target.paneKey, hostOf(entry))
  }
}
