// SLRM-2230 (FORK.md "Lost work"): which workspaces are in use, read from the runtime's
// `worktree.ps` rows through the same sources Sleepers lists, so `orca lost-work` agrees with it.
import type { RuntimeWorktreePsSummary } from '../../../shared/worktree/catalog/runtime-worktree-contracts'
import type { LostWorkUse } from '../../../shared/fork/lost-work-use'
import { deriveSleeperState, type SleeperSource } from '../../../shared/fork/sleepers'

type PsWorktree = Pick<RuntimeWorktreePsSummary, 'worktreeId' | 'liveTerminalCount' | 'isActive'>

type UseSource = Pick<
  SleeperSource,
  'kind' | 'worktreeId' | 'status' | 'processAlive' | 'hibernated'
>

export function lostWorkUseFromPs(
  worktrees: readonly PsWorktree[],
  sources: readonly UseSource[]
): Map<string, LostWorkUse> {
  const uses = new Map<string, LostWorkUse>()
  const entryFor = (worktreeId: string): LostWorkUse => {
    let use = uses.get(worktreeId)
    if (!use) {
      use = { agentRunning: false, openChats: 0, sleepingChats: 0, liveTerminals: 0, active: false }
      uses.set(worktreeId, use)
    }
    return use
  }
  for (const worktree of worktrees) {
    if (worktree.liveTerminalCount > 0 || worktree.isActive) {
      const use = entryFor(worktree.worktreeId)
      use.liveTerminals = worktree.liveTerminalCount
      use.active = worktree.isActive
    }
  }
  for (const source of sources) {
    if (!source.worktreeId) {
      continue
    }
    const state = deriveSleeperState(source)
    if (state === 'working' || state === 'needs-input') {
      entryFor(source.worktreeId).agentRunning = true
    }
    if (source.kind === 'chat') {
      const use = entryFor(source.worktreeId)
      if (state === 'asleep') {
        use.sleepingChats += 1
      } else {
        use.openChats += 1
      }
    }
  }
  return uses
}
