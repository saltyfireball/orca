// Archive on merge (FORK.md, SLRM-2397): with `forkArchiveOnMerge` on, a workspace whose pull
// request shows as merged is archived through the stock `worktree.archive` path, which keeps the
// branch and the workspace record and refuses a checkout with uncommitted or unpushed work. It
// leaves the open workspace, a busy one, the main checkout and one snoozed until merge (that
// snooze settles first) alone. A refused try waits 30 minutes. Mounted once through ForkRootHosts.
import { useEffect } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { toRuntimeWorktreeSelector } from '@/runtime/rpc/targets/runtime-worktree-selector'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'
import { createWorktreeAgentRowsSelector } from '@/components/sidebar/workspace-card/activity/worktree-agent-rows-projection'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  forkWorkspaceTagKey,
  readForkWorkspaceTagSettings,
  shouldForkArchiveOnMerge
} from '../../../../shared/fork/workspace-tags'
import { forkSnoozeWorkspaceKey } from '../../../../shared/fork/snooze'
import { isForkSnoozeWorktreeMerged } from '../snooze/snooze-watch'
import { readForkSnoozeEntries } from '../snooze/snooze-client'
import { forkClaudeWorktreeTarget } from '../claude-account-move/fork-claude-move-actions'
import { restoreForkArchivedWorktree } from './fork-archived-restore'

const TICK_MS = 60_000
const THROTTLE_MS = 2_000
const ARCHIVE_TIMEOUT_MS = 5 * 60_000

function busy(state: AppState, worktree: Worktree): boolean {
  const rows = createWorktreeAgentRowsSelector(worktree.id, worktree.hostId)(state)
  return rows.some((row) => row.entry.state !== 'done')
}

function snoozedUntilMerge(worktree: Worktree): boolean {
  const key = forkSnoozeWorkspaceKey(worktree.id, worktree.hostId)
  return readForkSnoozeEntries().some(
    (entry) =>
      entry.until.kind === 'merge' &&
      entry.target.kind === 'workspace' &&
      forkSnoozeWorkspaceKey(entry.target.worktreeId, entry.target.hostId) === key
  )
}

async function archive(state: AppState, worktree: Worktree): Promise<void> {
  const target = forkClaudeWorktreeTarget(state, worktree.id)
  if (!target) {
    return
  }
  const name = worktree.displayName || worktree.branch
  try {
    await callRuntimeRpc(
      target,
      'worktree.archive',
      { worktree: toRuntimeWorktreeSelector(worktree.id) },
      { timeoutMs: ARCHIVE_TIMEOUT_MS }
    )
    toast.message(
      translate('fork.archiveOnMerge.done', '{{name}} was archived: its pull request merged.', {
        name
      }),
      {
        action: {
          label: translate('fork.archiveOnMerge.undo', 'Undo'),
          onClick: () => void restoreForkArchivedWorktree(worktree)
        }
      }
    )
  } catch (error) {
    // Refused (uncommitted work, a running process): said once, tried again in 30 minutes.
    toast.message(
      translate('fork.archiveOnMerge.refused', '{{name}} merged but was not archived: {{detail}}', {
        name,
        detail: error instanceof Error ? error.message : String(error)
      })
    )
  }
}

export function ForkArchiveOnMergeWatcher(): null {
  useEffect(() => {
    const triedAt = new Map<string, number>()
    let timer: ReturnType<typeof setTimeout> | null = null
    const check = (): void => {
      timer = null
      const state = useAppStore.getState()
      if (!readForkWorkspaceTagSettings(state.settings).archiveOnMerge) {
        return
      }
      const now = Date.now()
      for (const list of Object.values(selectWorktreesByRepo(state) ?? {})) {
        for (const worktree of list ?? []) {
          const key = forkWorkspaceTagKey(worktree.id, worktree.hostId)
          const facts = {
            isArchived: worktree.isArchived,
            isMainWorktree: worktree.isMainWorktree,
            hasBranch: Boolean(worktree.branch),
            merged: false,
            active: state.activeWorktreeId === worktree.id,
            busy: false,
            snoozedUntilMerge: false,
            lastTriedAt: triedAt.get(key) ?? 0
          }
          // The cheap facts first; the review, agent and snooze reads only for a candidate.
          if (!shouldForkArchiveOnMerge({ ...facts, merged: true }, now)) {
            continue
          }
          facts.merged = isForkSnoozeWorktreeMerged(state, worktree)
          facts.busy = facts.merged && busy(state, worktree)
          facts.snoozedUntilMerge = facts.merged && snoozedUntilMerge(worktree)
          if (shouldForkArchiveOnMerge(facts, now)) {
            triedAt.set(key, now)
            void archive(state, worktree)
          }
        }
      }
    }
    const schedule = (): void => {
      if (timer === null) {
        timer = setTimeout(check, THROTTLE_MS)
      }
    }
    const stopStore = useAppStore.subscribe(schedule)
    const stopTick = installWindowVisibilityInterval({ run: check, intervalMs: TICK_MS })
    return () => {
      stopStore()
      stopTick()
      if (timer !== null) {
        clearTimeout(timer)
      }
    }
  }, [])
  return null
}
