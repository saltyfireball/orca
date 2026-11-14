// Decision inbox (FORK.md "Idle recovery"): what a row can do. Answer and pause go to the main
// process through `window.api.forkIdleRecovery`; jump is the stock gesture (open the agent's
// pane), so it behaves exactly as the sidebar row does.
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { activateWorktreeAgentPane } from '@/components/sidebar/workspace-card/activity/use-worktree-agent-activation'
import { parsePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'
import type {
  ForkIdleRecoveryAnswerOutcome,
  ForkIdleRecoveryInboxItem
} from '../../../../shared/fork/idle-recovery-wire'
import { chatPaneKeyForSession } from '../chat-sleep/chat-sleep-view'
import { forkIdleRecoveryBridge, refreshForkDecisionInbox } from './decision-inbox-store'
import { oldestWaitingChat } from './decision-inbox-view'

function describe(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}

/** Where a listed chat lives in this window: its worktree and pane key, or null if not open here. */
function locate(item: ForkIdleRecoveryInboxItem): { worktreeId: string; paneKey: string } | null {
  const state = useAppStore.getState()
  if (item.kind === 'terminal') {
    const worktreeId = item.worktreeId ?? state.agentStatusByPaneKey?.[item.chatId]?.worktreeId
    return worktreeId ? { worktreeId, paneKey: item.chatId } : null
  }
  const tabsByWorktree = state.unifiedTabsByWorktree ?? {}
  const candidates = item.worktreeId ? [item.worktreeId] : Object.keys(tabsByWorktree)
  for (const worktreeId of candidates) {
    const paneKey = chatPaneKeyForSession(tabsByWorktree[worktreeId], item.chatId)
    if (paneKey) {
      return { worktreeId, paneKey }
    }
  }
  return null
}

/** Open the chat's pane. False, with a toast, when this window has no tab for it. */
export function jumpToDecisionInboxChat(item: ForkIdleRecoveryInboxItem): boolean {
  const place = locate(item)
  const parsed = place ? parsePaneKey(place.paneKey) : null
  if (!place || !parsed) {
    toast.message(
      translate('fork.decisionInbox.toast.noTab', 'That chat has no open tab in this window.')
    )
    return false
  }
  activateWorktreeAgentPane(place.worktreeId, parsed.tabId, place.paneKey)
  return true
}

function answerOutcomeMessage(outcome: Exclude<ForkIdleRecoveryAnswerOutcome, 'sent'>): string {
  if (outcome === 'not-found') {
    return translate('fork.decisionInbox.toast.notFound', 'That chat is gone.')
  }
  if (outcome === 'not-waiting') {
    return translate(
      'fork.decisionInbox.toast.notWaiting',
      'That chat is no longer waiting on you, so the answer was not sent.'
    )
  }
  return translate(
    'fork.decisionInbox.toast.unavailable',
    'The answer was not sent: idle recovery is off, or the chat cannot take a message right now.'
  )
}

/** Send the user's answer to a waiting chat. True only when it went to the chat. */
export async function answerDecisionInboxChat(
  item: ForkIdleRecoveryInboxItem,
  text: string
): Promise<boolean> {
  const bridge = forkIdleRecoveryBridge()
  if (!bridge) {
    return false
  }
  try {
    const { result } = await bridge.answer({ chatId: item.chatId, text })
    if (result === 'sent') {
      toast.success(
        translate('fork.decisionInbox.toast.sent', 'Answer sent to {{title}}.', {
          title: item.title
        })
      )
      return true
    }
    toast.message(answerOutcomeMessage(result))
    return false
  } catch (failure) {
    toast.error(translate('fork.decisionInbox.toast.sendFailed', 'Could not send the answer.'), {
      description: describe(failure)
    })
    return false
  } finally {
    void refreshForkDecisionInbox()
  }
}

/** Leave one chat alone, or let idle recovery look at it again. */
export async function setDecisionInboxChatPaused(
  item: ForkIdleRecoveryInboxItem,
  paused: boolean
): Promise<void> {
  const bridge = forkIdleRecoveryBridge()
  if (!bridge) {
    return
  }
  try {
    const result = await bridge.pause({ chatId: item.chatId, paused })
    if (!result.saved) {
      toast.error(
        translate(
          'fork.decisionInbox.toast.pauseNotSaved',
          'Settings cannot be saved here, so nothing changed.'
        )
      )
    }
  } catch (failure) {
    toast.error(translate('fork.decisionInbox.toast.pauseFailed', 'Could not change the pause.'), {
      description: describe(failure)
    })
  } finally {
    void refreshForkDecisionInbox()
  }
}

/** Read the inbox and open the chat that has waited on the user longest. */
export async function jumpToOldestWaitingChat(): Promise<boolean> {
  const bridge = forkIdleRecoveryBridge()
  if (!bridge) {
    return false
  }
  try {
    const item = oldestWaitingChat((await bridge.inbox()).items)
    if (!item) {
      toast.message(translate('fork.decisionInbox.toast.noneWaiting', 'No chat is waiting on you.'))
      return false
    }
    return jumpToDecisionInboxChat(item)
  } catch (failure) {
    toast.error(
      translate('fork.decisionInbox.toast.readFailed', 'Could not read the Decision inbox.'),
      { description: describe(failure) }
    )
    return false
  }
}
