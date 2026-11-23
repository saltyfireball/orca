// Needs you (FORK.md "Needs you list", BAD-759): where an entry takes the owner, from any view, and
// Next and Back along a trail of jumps. A bot's ask opens on its bot's Home tab with the item and
// its ask card in view (a paired server's bot too); a chat opens its tab; an agent waiting on an
// approval or a question opens its pane, where the prompt is.
import { useAppStore } from '@/store'
import { openBotHomeTab } from '@/lib/bot-catalog'
import { openBotItem } from '@/components/bots/items/bot-item-open'
import { activateAndRevealWorkspace } from '@/lib/workspace/activation/worktree-activation'
import { activateWorktreeAgentPane } from '@/components/sidebar/workspace-card/activity/use-worktree-agent-activation'
import { jumpToDecisionInboxChat } from '../decision-inbox/decision-inbox-actions'
import { jumpToForkBoardAsk } from '../letters/board-actions'
import { revealAskCard } from '../bot-asks/bot-row-ask-jump'
import { needsYouNextEntry, type NeedsYouEntry } from './needs-you-view'
import {
  closeNeedsYou,
  endNeedsYouTrail,
  readNeedsYouTrail,
  recordNeedsYouJump,
  type NeedsYouReturn
} from './needs-you-store'

export function captureNeedsYouReturn(): NeedsYouReturn {
  const state = useAppStore.getState()
  return {
    activeView: state.activeView,
    worktreeId: state.activeWorktreeId ?? null,
    hostId: state.activeWorkspaceExecutionHostId ?? null,
    tabId: state.activeTabId ?? null,
    tabType: state.activeTabType,
    rightSidebarOpen: state.rightSidebarOpen,
    rightSidebarTab: state.rightSidebarTab
  }
}

async function go(entry: NeedsYouEntry): Promise<boolean> {
  const target = entry.target
  switch (target.kind) {
    case 'bot-ask': {
      const before = typeof document === 'undefined' ? null : document.querySelector(ASK_CARD)
      if (!(await openBotHomeTab(target.ask.bot))) {
        return false
      }
      openBotItem(target.ask.bot, target.ask.item.uid)
      revealAskCard(before)
      return true
    }
    case 'chat':
      return jumpToDecisionInboxChat(target.item)
    case 'board':
      return jumpToForkBoardAsk(target.ask)
    case 'agent': {
      const { card } = target
      activateWorktreeAgentPane(card.worktreeId, card.tabId, card.paneKey, card.executionHostId)
      return true
    }
  }
}

const ASK_CARD = '[data-bot-item-ask="open"]'

/**
 * Takes the owner to the entry and notes it on the trail, at its place `index` in the list, so Next
 * and Back work. False, with the list left as it was, when it could not be shown.
 */
export async function jumpToNeedsYou(entry: NeedsYouEntry, index: number): Promise<boolean> {
  const from = captureNeedsYouReturn()
  closeNeedsYou()
  const shown = await go(entry).catch((error: unknown) => {
    console.warn('[needs you] jump failed', error)
    return false
  })
  if (shown) {
    recordNeedsYouJump(from, { key: entry.key, index })
  }
  return shown
}

/** The entry after the one last shown. False when nothing else waits. */
export async function jumpToNextNeedsYou(entries: readonly NeedsYouEntry[]): Promise<boolean> {
  const next = needsYouNextEntry(entries, readNeedsYouTrail().last)
  if (!next) {
    return false
  }
  return jumpToNeedsYou(
    next,
    entries.findIndex((entry) => entry.key === next.key)
  )
}

/** Returns to where the owner was before the trail's first jump, and ends the trail. */
export function backFromNeedsYou(): boolean {
  const { ret } = readNeedsYouTrail()
  endNeedsYouTrail()
  if (!ret) {
    return false
  }
  const state = useAppStore.getState()
  if (ret.worktreeId) {
    activateAndRevealWorkspace(ret.worktreeId, {
      executionHostId: ret.hostId ?? undefined,
      revealInSidebar: false
    })
  }
  if (ret.tabId) {
    state.setActiveTab(ret.tabId)
  }
  if (ret.worktreeId) {
    useAppStore.getState().setActiveTabType(ret.tabType, ret.worktreeId)
  }
  const after = useAppStore.getState()
  after.setRightSidebarTab(ret.rightSidebarTab)
  after.setRightSidebarOpen(ret.rightSidebarOpen)
  if (ret.activeView !== after.activeView) {
    after.setActiveView(ret.activeView)
  }
  return true
}
