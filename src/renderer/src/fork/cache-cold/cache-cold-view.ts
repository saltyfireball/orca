// SLRM-2103 (FORK.md "Usage ledger and cache-cold cue"): which native chat an agent row shows.
import type { Tab } from '../../../../shared/tab-types'
import { structuredAgentSessionPaneKey } from '../../../../shared/agent-session/view/structured-agent-session-projection'

/** The chat session behind an agent row, or undefined for a terminal agent or a gone tab. */
export function chatSessionIdForRow(
  tabs: readonly Tab[] | undefined,
  tabId: string,
  paneKey: string
): string | undefined {
  const tab = (tabs ?? []).find((t) => t.id === tabId)
  if (!tab || tab.contentType !== 'agent-session' || !tab.entityId) {
    return undefined
  }
  return structuredAgentSessionPaneKey(tab.id, tab.entityId) === paneKey ? tab.entityId : undefined
}
