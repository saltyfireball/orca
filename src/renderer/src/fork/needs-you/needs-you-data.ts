// Needs you (FORK.md "Needs you list", BAD-759): the one live merge of every source, shared by the
// control, the list and Next. It reads what the Decision inbox already reads (its live copies, so
// nothing is read twice) and nothing while the feature is off.
import { useMemo } from 'react'
import { useBotHostLabels } from '@/components/bots/use-bot-host-label'
import {
  forkIdleRecoveryBridge,
  useForkDecisionInbox,
  useForkDecisionInboxBotAsks,
  useForkDecisionInboxOn
} from '../decision-inbox/decision-inbox-store'
import { decisionInboxSections } from '../decision-inbox/decision-inbox-view'
import { useForkBoard, useForkBoardEnabled } from '../letters/board-store'
import {
  NEEDS_YOU_NONE,
  type NeedsYouData,
  useNeedsYouAgents,
  useNeedsYouEnabled
} from './needs-you-store'
import { needsYouEntries } from './needs-you-view'

/** Computes the merge from every source; mounted once, by `ForkNeedsYouPublisher`. */
export function useComputedNeedsYouData(): NeedsYouData {
  const enabled = useNeedsYouEnabled()
  const recovery = useForkDecisionInboxOn() && forkIdleRecoveryBridge() !== null
  const board = useForkBoardEnabled()
  const botAsks = useForkDecisionInboxBotAsks()
  const inbox = useForkDecisionInbox(enabled && recovery)
  const boardSnapshot = useForkBoard(enabled && board)
  const boardView = boardSnapshot.view
  const agents = useNeedsYouAgents()
  const hostIds = useMemo(() => botAsks.map((ask) => ask.bot.hostId), [botAsks])
  const labels = useBotHostLabels(hostIds)
  return useMemo(() => {
    if (!enabled) {
      return NEEDS_YOU_NONE
    }
    const items = inbox.result?.items ?? []
    const sections = decisionInboxSections(items)
    return {
      entries: needsYouEntries({
        botAsks,
        chats: items,
        chatClockOffset: inbox.result ? inbox.receivedAt - inbox.result.now : 0,
        board: boardView?.asks ?? [],
        boardClockOffset: boardView ? boardSnapshot.receivedAt - boardView.now : 0,
        agents,
        hostLabelOf: (hostId) => labels.get(hostId) ?? null
      }),
      inboxOnly: sections.stalled.length + sections.paused.length
    }
  }, [enabled, botAsks, inbox, boardView, boardSnapshot.receivedAt, agents, labels])
}
