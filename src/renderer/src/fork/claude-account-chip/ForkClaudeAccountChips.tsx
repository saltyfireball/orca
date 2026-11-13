// SLRM-1503: the chip as each upstream surface places it, one line per hook. Each chip opens
// "Move to account" on its own host unless the caller passes its own `menu`.
import React from 'react'
import type { AgentType } from '../../../../shared/agent-status/contracts/agent-status-types'
import { TAB_LABEL_WIDTH_CLASSES } from '@/components/tab-bar/tab-width-rules'
import { ForkClaudeAccountChip, type ForkClaudeAccountChipProps } from './ForkClaudeAccountChip'
import { ForkAgentQueueTabBadge } from '../agent-queue/ForkAgentQueueBanner'
import {
  useAgentRowMoveMenu,
  useChatTabMoveMenu,
  useWorktreeMoveMenu
} from './claude-chip-move-menu'
import {
  useClaudeAccountForAgentRow,
  useClaudeAccountForTab,
  useClaudeAccountForWorktree
} from './use-claude-account'
import { ForkChatSleepRowMark, ForkChatSleepTabMark } from '../chat-sleep/ForkChatSleep'

type SlotProps = Pick<ForkClaudeAccountChipProps, 'className' | 'onOpenMenu' | 'menu'>

/** A terminal tab running Claude in any pane, or a native Claude chat tab. */
export function ForkClaudeAccountTabChip({
  tab,
  unified,
  chat,
  className = 'mr-1',
  ...slot
}: SlotProps & {
  tab: { id: string; worktreeId: string }
  /** The unified tab id, which names the host when one worktree id is on two hosts. */
  unified?: string
  /** Set for a native chat tab; a non-Claude chat resolves to nothing. */
  chat?: { sessionId: string; agent: AgentType | undefined }
}): React.JSX.Element | null {
  const resolution = useClaudeAccountForTab({
    worktreeId: tab.worktreeId,
    tabId: tab.id,
    unifiedTabId: unified,
    chatSessionId: chat?.sessionId
  })
  const menu = useChatTabMoveMenu(tab.worktreeId, chat?.sessionId, unified)
  return (
    <ForkClaudeAccountChip resolution={resolution} className={className} menu={menu} {...slot} />
  )
}

type TabChipProps = Parameters<typeof ForkClaudeAccountTabChip>[0]

/** SortableTab's title span with the tab's chip after it; owns the span so the hook is one line. */
export function ForkTabTitle({
  title,
  ...chip
}: TabChipProps & { title: string }): React.JSX.Element {
  return (
    <>
      <span className={`${TAB_LABEL_WIDTH_CLASSES} mr-1`}>{title}</span>
      <ForkChatSleepTabMark worktreeId={chip.tab.worktreeId} sessionId={chip.chat?.sessionId} />
      {/* SLRM-2098: queued for a free agent slot. */}
      <ForkAgentQueueTabBadge sessionId={chip.chat?.sessionId} />
      <ForkClaudeAccountTabChip {...chip} />
    </>
  )
}

/** A worktree row: one account, or `Mixed` when its Claude sessions use several. */
export function ForkClaudeAccountWorktreeChip({
  worktreeId,
  ...slot
}: SlotProps & { worktreeId: string }): React.JSX.Element | null {
  const resolution = useClaudeAccountForWorktree(worktreeId)
  const menu = useWorktreeMoveMenu(worktreeId)
  return <ForkClaudeAccountChip resolution={resolution} menu={menu} {...slot} />
}

/** An agent row in the dashboard or a worktree card, with chat sleep's moon. */
export function ForkClaudeAccountAgentRowChip({
  agent,
  ...slot
}: SlotProps & {
  agent: { paneKey: string; tab: { id: string; worktreeId: string } }
}): React.JSX.Element | null {
  const resolution = useClaudeAccountForAgentRow(agent.tab.worktreeId, agent.tab.id, agent.paneKey)
  const menu = useAgentRowMoveMenu(agent.tab.worktreeId, agent.tab.id, agent.paneKey)
  return (
    <>
      <ForkChatSleepRowMark agent={agent} />
      <ForkClaudeAccountChip resolution={resolution} menu={menu} {...slot} />
    </>
  )
}
