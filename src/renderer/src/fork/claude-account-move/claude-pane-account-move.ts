// SLRM-1503: Claude running in a terminal pane on this desktop moves by restarting the pane on
// its own conversation, through the stock account-restart queue (which waits for an open turn).
// The restart carries a marker main turns into a pointer for that pane alone (FORK.md), so the
// other panes keep following the selected account.
import type { AppState } from '@/store'
import { getExecutionHostIdForWorktree } from '@/lib/workspace/ownership/worktree-runtime-owner'
import { getLocalProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import {
  FORK_CLAUDE_SYSTEM_DEFAULT,
  FORK_CLAUDE_TERMINAL_ACCOUNT_ENV
} from '../../../../shared/fork/claude-account-move'
import { makePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'

/** paneKey -> the account its next account restart launches on. */
const paneMarks = new Map<string, string>()

/** The slice of the store a pane move reads; the whole store fits it. */
type PaneMoveState = {
  tabsByWorktree: Record<string, readonly { id: string }[] | undefined>
  terminalLayoutsByTabId: Record<string, { ptyIdsByLeafId?: Record<string, string> } | undefined>
  agentStatusByPaneKey: Record<string, { agentType?: string } | undefined>
  queuePaneAccountRestarts(ptyIds: string[], agent: 'claude'): void
}

/** True when this desktop runs the worktree's terminals natively (not WSL, SSH or a paired host). */
export function canMoveClaudePanesIn(state: AppState, worktreeId: string): boolean {
  if (getExecutionHostIdForWorktree(state, worktreeId) !== LOCAL_EXECUTION_HOST_ID) {
    return false
  }
  const runtime = getLocalProjectExecutionRuntimeContext(state, worktreeId)
  return !(runtime?.status === 'resolved' && runtime.runtime.kind === 'wsl')
}

/** Queue a restart onto `accountId` for every Claude pane in the worktree; returns how many. */
export function queueClaudePaneAccountMoves(
  state: PaneMoveState,
  worktreeId: string,
  accountId: string | null
): number {
  const ptyIds: string[] = []
  for (const tab of state.tabsByWorktree[worktreeId] ?? []) {
    const leaves = state.terminalLayoutsByTabId[tab.id]?.ptyIdsByLeafId ?? {}
    for (const [leafId, ptyId] of Object.entries(leaves)) {
      const paneKey = makePaneKey(tab.id, leafId)
      if (state.agentStatusByPaneKey[paneKey]?.agentType !== 'claude') {
        continue
      }
      paneMarks.set(paneKey, accountId ?? FORK_CLAUDE_SYSTEM_DEFAULT)
      ptyIds.push(ptyId)
    }
  }
  state.queuePaneAccountRestarts(ptyIds, 'claude')
  return ptyIds.length
}

/** Stock hook: adds the marker to a Claude pane's account restart once, if the pane was moved. */
export function withForkClaudePaneAccount<T extends { env?: Record<string, string> }>(
  startup: T | null,
  agent: string,
  paneKey: string
): T | null {
  const mark = agent === 'claude' ? paneMarks.get(paneKey) : undefined
  if (!startup || mark === undefined) {
    return startup
  }
  paneMarks.delete(paneKey)
  return { ...startup, env: { ...startup.env, [FORK_CLAUDE_TERMINAL_ACCOUNT_ENV]: mark } }
}

export function resetClaudePaneAccountMovesForTests(): void {
  paneMarks.clear()
}
