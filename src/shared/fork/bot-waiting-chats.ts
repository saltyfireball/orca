// A bot's chats that wait on the owner (FORK.md "Needs you list", BAD-795): every agent row of the
// bot's home that asks, and that none of the bot's own needs (its Home chat, side chats, threads,
// runs, workers) already speaks for, becomes a need of its own. So what the sidebar row counts is
// what the bot's panel lists.
import type { AgentStatusEntry } from '../agent-status/contracts/agent-status-types'
import type { BotActivity, BotWorkerRow } from '../bots/bot-activity-model'
import type { BotChatTreeChat } from '../bots/bot-chat-tree'
import { handedAgentRows } from '../bots/bot-activity-handed-agents'
import { clipActivityTitle } from '../bots/bot-activity-recorded-workers'
import { structuredAgentSessionStatusPaneKey } from '../agent-session/view/structured-agent-session-tab'
import { sleeperChatSessionId } from './sleepers-ps-sources'

export type ForkBotWaitingSideChat = { sessionId: string; title: string }

export type ForkBotWaitingChats = {
  /** `botNow`'s side chats: those the chat tree says wait, then the rest. */
  sideChats: readonly ForkBotWaitingSideChat[]
  /** Terminal agents in the home that ask, as the worker rows Activity lists others by. */
  panes: readonly BotWorkerRow[]
}

export type ForkBotWaitingChatsInput = {
  /** The home's agent rows that wait on an answer; never a sub-agent's. */
  asking: readonly AgentStatusEntry[]
  chatSessionId: string | null
  homeWorkspaceId: string
  activity: Pick<BotActivity, 'workers' | 'inProgress'>
  chats: readonly Pick<BotChatTreeChat, 'chatId' | 'liveSessionId' | 'title'>[]
  waitingSideChats: readonly ForkBotWaitingSideChat[]
}

const NO_PANES: readonly BotWorkerRow[] = []

export function forkBotWaitingChats(input: ForkBotWaitingChatsInput): ForkBotWaitingChats {
  const { asking, chatSessionId, chats, waitingSideChats } = input
  const heldPanes = new Set<string>()
  const heldSessions = new Set(waitingSideChats.map((chat) => chat.sessionId))
  if (chatSessionId) {
    heldPanes.add(structuredAgentSessionStatusPaneKey(chatSessionId))
  }
  for (const row of [...input.activity.workers, ...input.activity.inProgress]) {
    if (row.kind !== 'worker') {
      if (row.sessionId) {
        heldSessions.add(row.sessionId)
      }
      continue
    }
    if (row.paneKey) {
      heldPanes.add(row.paneKey)
    }
    if (row.worker?.chatSessionId) {
      heldSessions.add(row.worker.chatSessionId)
    }
  }
  const sideChats: ForkBotWaitingSideChat[] = []
  const panes: AgentStatusEntry[] = []
  for (const entry of asking) {
    if (heldPanes.has(entry.paneKey)) {
      continue
    }
    const liveId = sleeperChatSessionId(entry.paneKey)
    if (!liveId) {
      heldPanes.add(entry.paneKey)
      panes.push(entry)
      continue
    }
    // A chat a /clear moved on keeps its first id, the one its line opens.
    const chat = chats.find((each) => each.chatId === liveId || each.liveSessionId === liveId)
    const sessionId = chat?.chatId ?? liveId
    if (heldSessions.has(sessionId) || heldSessions.has(liveId)) {
      continue
    }
    heldSessions.add(sessionId)
    sideChats.push({ sessionId, title: chat?.title || clipActivityTitle(entry.prompt) })
  }
  return {
    sideChats: sideChats.length > 0 ? [...waitingSideChats, ...sideChats] : waitingSideChats,
    panes:
      panes.length > 0
        ? handedAgentRows(
            panes.map((entry) => ({
              paneKey: entry.paneKey,
              entry,
              worktreeId: entry.worktreeId ?? input.homeWorkspaceId
            }))
          )
        : NO_PANES
  }
}
