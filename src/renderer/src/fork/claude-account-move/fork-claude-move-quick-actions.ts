// SLRM-1503: command palette entries that open the account picker for the active Claude chat or
// the active worktree's Claude chats. Spread into the stock catalog (FORK.md).
import { ArrowRightLeft } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { CmdJQuickAction } from '@/components/cmd-j/quick-actions'
import type {
  CmdJQuickActionAvailability,
  CmdJQuickActionContext
} from '@/components/cmd-j/quick-action-context'
import { openForkMoveAccountDialog } from './ForkMoveAccountDialog'
import {
  activeForkClaudeChat,
  forkClaudeChatTarget,
  forkClaudeWorktreeTarget
} from './fork-claude-move-actions'

function activeChat(ctx: CmdJQuickActionContext) {
  return activeForkClaudeChat(useAppStore.getState(), ctx.activeWorktreeId, ctx.activeGroupId)
}

function chatAvailability(ctx: CmdJQuickActionContext): CmdJQuickActionAvailability {
  return activeChat(ctx) ? { available: true } : { available: false, reason: 'no-active-chat' }
}

function worktreeAvailability(ctx: CmdJQuickActionContext): CmdJQuickActionAvailability {
  return ctx.activeWorktreeId
    ? { available: true }
    : { available: false, reason: 'no-active-workspace' }
}

export function getForkClaudeMoveQuickActions(): CmdJQuickAction[] {
  const chatTitle = translate('fork.accountMove.paletteChat', 'Move this chat to account...')
  const worktreeTitle = translate(
    'fork.accountMove.paletteWorktree',
    "Move this worktree's chats to account..."
  )
  const keywords = [
    translate('fork.accountMove.keywordAccount', 'claude account'),
    translate('fork.accountMove.keywordSwitch', 'switch account'),
    translate('fork.accountMove.keywordSubscription', 'subscription')
  ]
  return [
    {
      id: 'fork-move-chat-account',
      kind: 'action',
      title: chatTitle,
      description: translate(
        'fork.accountMove.paletteChatDescription',
        'Run the active Claude chat on another account of its host'
      ),
      icon: ArrowRightLeft,
      verbKeywords: [chatTitle, ...keywords],
      isAvailable: chatAvailability,
      run: async (ctx) => {
        const chat = activeChat(ctx)
        if (!chat) {
          return { status: 'unavailable', reason: 'no-active-chat' }
        }
        openForkMoveAccountDialog({
          target: forkClaudeChatTarget(useAppStore.getState(), chat.worktreeId, chat.sessionId),
          scope: { sessionId: chat.sessionId }
        })
        return { status: 'ok' }
      }
    },
    {
      id: 'fork-move-worktree-account',
      kind: 'action',
      title: worktreeTitle,
      description: translate(
        'fork.accountMove.paletteWorktreeDescription',
        'Run every Claude chat in this worktree on another account of its host'
      ),
      icon: ArrowRightLeft,
      verbKeywords: [worktreeTitle, ...keywords],
      isAvailable: worktreeAvailability,
      run: async (ctx) => {
        const worktreeId = ctx.activeWorktreeId
        if (!worktreeId) {
          return { status: 'unavailable', reason: 'no-active-workspace' }
        }
        openForkMoveAccountDialog({
          target: forkClaudeWorktreeTarget(useAppStore.getState(), worktreeId),
          scope: { worktreeId }
        })
        return { status: 'ok' }
      }
    }
  ]
}
