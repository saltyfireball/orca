// SLRM-1503: the account chip's `menu` slot, which opens "Move to account" on the chip's own host.
// The menu is left out where that host cannot move the chats: direct SSH (no runtime), a WSL
// distro (its chats follow the distro's own selection) and a host without the fork move RPC.
import React from 'react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { getLocalProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { ForkClaudeMoveScope } from '../claude-account-move/claude-account-move-client'
import { ForkMoveAccountMenu } from '../claude-account-move/ForkMoveAccountMenu'
import { forkClaudeWorktreeTarget } from '../claude-account-move/fork-claude-move-actions'
import { agentRowEvidence, chatEvidence } from './claude-chip-evidence'
import { getChatHome, transportKey } from './claude-chip-host-cache'

export type ChipMenu = (chip: React.ReactElement) => React.ReactNode

type MoveTarget = { target: RuntimeClientTarget; scope: ForkClaudeMoveScope }

function targetFromKey(key: string): RuntimeClientTarget {
  return key === 'local'
    ? { kind: 'local' }
    : { kind: 'environment', environmentId: key.slice('environment:'.length) }
}

/** A native chat moves on the host its chip reads; the read failing means no move RPC there. */
function chatMoveKey(
  evidence: ReturnType<typeof chatEvidence>
): { key: string; sessionId: string } | null {
  if (!evidence?.chatSessionId || evidence.wslHostDistro) {
    return null
  }
  if (getChatHome(evidence.transport, evidence.chatSessionId) === 'failed') {
    return null
  }
  return { key: transportKey(evidence.transport), sessionId: evidence.chatSessionId }
}

/** The worktree's chats move on the host that runs its native chats; not in WSL. */
export function worktreeMoveTargetKey(state: AppState, worktreeId: string): string | null {
  const target = forkClaudeWorktreeTarget(state, worktreeId)
  if (!target) {
    return null
  }
  if (target.kind === 'local') {
    const runtime = getLocalProjectExecutionRuntimeContext(state, worktreeId)
    if (runtime?.status === 'resolved' && runtime.runtime.kind === 'wsl') {
      return null
    }
  }
  return transportKey(target)
}

function useMoveMenu(selectKey: (state: AppState) => string | null): ChipMenu | undefined {
  // Plain text so a store write that changes nothing here re-renders nothing.
  const key = useAppStore(selectKey)
  return React.useMemo(() => {
    if (!key) {
      return undefined
    }
    const parsed: MoveTarget = JSON.parse(key)
    return (chip: React.ReactElement) => (
      <ForkMoveAccountMenu trigger={chip} target={parsed.target} scope={parsed.scope} />
    )
  }, [key])
}

function encode(targetKey: string, scope: ForkClaudeMoveScope): string {
  const value: MoveTarget = { target: targetFromKey(targetKey), scope }
  return JSON.stringify(value)
}

/** A native chat tab's chip moves that chat. A terminal tab has no chat to move. */
export function useChatTabMoveMenu(
  worktreeId: string,
  sessionId: string | undefined,
  unifiedTabId: string | undefined
): ChipMenu | undefined {
  return useMoveMenu((state) => {
    const chat =
      sessionId === undefined
        ? null
        : chatMoveKey(chatEvidence(state, worktreeId, sessionId, unifiedTabId))
    return chat ? encode(chat.key, { sessionId: chat.sessionId }) : null
  })
}

/** An agent row's chip moves its native chat; a Claude terminal pane row has none. */
export function useAgentRowMoveMenu(
  worktreeId: string,
  tabId: string,
  paneKey: string
): ChipMenu | undefined {
  return useMoveMenu((state) => {
    const chat = chatMoveKey(agentRowEvidence(state, worktreeId, tabId, paneKey))
    return chat ? encode(chat.key, { sessionId: chat.sessionId }) : null
  })
}

/** A worktree chip moves every Claude chat in the worktree, its terminal panes included. */
export function useWorktreeMoveMenu(worktreeId: string): ChipMenu | undefined {
  return useMoveMenu((state) => {
    const key = worktreeMoveTargetKey(state, worktreeId)
    return key ? encode(key, { worktreeId }) : null
  })
}
