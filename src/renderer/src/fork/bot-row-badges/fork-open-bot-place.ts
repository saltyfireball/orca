// A click on the chat a bot row's second line names (BAD-658) opens that chat as the sidebar's own
// chat rows do. The place carries the chat's pane key; its session is the key's tab's.
import { openBotSession } from '@/components/bots/bot-session-open'
import type { Bot } from '../../../../shared/bot-types'
import { structuredAgentSessionIdOfTab } from '../../../../shared/agent-session/view/structured-agent-session-tab'

/** The session a chat pane key names, or null for a key that is not a structured chat's. */
export function forkBotPlaceSessionId(paneKey: string): string | null {
  const tabId = paneKey.slice(0, Math.max(0, paneKey.indexOf(':')))
  return structuredAgentSessionIdOfTab(tabId)
}

export function forkOpenBotPlace(bot: Bot, paneKey: string): void {
  const sessionId = forkBotPlaceSessionId(paneKey)
  if (sessionId) {
    openBotSession(bot, sessionId)
  }
}
