// SLRM-1503: where a chat or worktree's Claude chats run, and the one move action every entry
// point (tab menu, account chip, palette dialog) runs.
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore, type AppState } from '@/store'
import {
  resolveStructuredAgentSessionOwner,
  structuredAgentSessionTargetForHost,
  structuredAgentSessionTargetForTab
} from '@/runtime/structured-agent-session-owner'
import type { ForkClaudeMoveResponse } from '../../../../shared/fork/claude-account-move'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { moveClaudeChatsToAccount, type ForkClaudeMoveScope } from './claude-account-move-client'
import { canMoveClaudePanesIn, queueClaudePaneAccountMoves } from './claude-pane-account-move'
import type { ForkClaudeMoveAccountChoice } from './use-fork-claude-move-accounts'

type ChatTab = AppState['unifiedTabsByWorktree'][string][number]

function claudeChatTab(state: AppState, worktreeId: string, sessionId: string): ChatTab | null {
  return (
    (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
      (tab) => tab.contentType === 'agent-session' && tab.entityId === sessionId
    ) ?? null
  )
}

/** The runtime that runs this native chat; null for a host no runtime serves (an SSH host). */
export function forkClaudeChatTarget(
  state: AppState,
  worktreeId: string,
  sessionId: string
): RuntimeClientTarget | null {
  const tab = claudeChatTab(state, worktreeId, sessionId)
  return tab ? structuredAgentSessionTargetForTab(state, tab) : null
}

/** The runtime that runs the worktree's native chats. */
export function forkClaudeWorktreeTarget(
  state: AppState,
  worktreeId: string
): RuntimeClientTarget | null {
  return structuredAgentSessionTargetForHost(resolveStructuredAgentSessionOwner(state, worktreeId))
}

/** The active tab of the active group, when it is a native Claude chat. */
export function activeForkClaudeChat(
  state: AppState,
  worktreeId: string | null,
  groupId: string | null
): { worktreeId: string; sessionId: string } | null {
  if (!worktreeId || !groupId) {
    return null
  }
  const group = (state.groupsByWorktree[worktreeId] ?? []).find((entry) => entry.id === groupId)
  const tab = (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
    (entry) => entry.id === group?.activeTabId
  )
  return tab?.contentType === 'agent-session' && tab.agentSessionAgent === 'claude'
    ? { worktreeId, sessionId: tab.entityId }
    : null
}

/**
 * Move the chats in scope to `choice`. A worktree move on this desktop also restarts the
 * worktree's Claude terminal panes on that account, each once its turn ends.
 */
export async function runForkClaudeMove(
  target: RuntimeClientTarget,
  scope: ForkClaudeMoveScope,
  choice: Pick<ForkClaudeMoveAccountChoice, 'id' | 'label'>
): Promise<ForkClaudeMoveResponse | null> {
  const response = await moveClaudeChatsToAccount(target, scope, choice.id, {
    accountLabel: choice.label
  })
  const state = useAppStore.getState()
  if (
    'worktreeId' in scope &&
    target.kind === 'local' &&
    canMoveClaudePanesIn(state, scope.worktreeId)
  ) {
    const panes = queueClaudePaneAccountMoves(state, scope.worktreeId, choice.id)
    if (panes > 0) {
      toast.info(
        translate(
          'fork.accountMove.panesQueued',
          '{{count}} Claude terminal panes restart on {{account}} once each is idle.',
          { count: panes, account: choice.label }
        )
      )
    }
  }
  return response
}
