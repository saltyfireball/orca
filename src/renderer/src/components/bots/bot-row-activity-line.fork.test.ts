// Fork test (BAD-658): a place on a bot's row line carries the pane key of the chat it names, so a
// click on its name opens that chat. Kept apart from upstream's row-line tests, which upstream cut
// from its suite.
import { expect, it } from 'vitest'
import { buildWorktreeAgentRows } from '@/components/sidebar/workspace-card/activity/worktree-agent-rows'
import { structuredAgentSessionStatusPaneKey } from '../../../../shared/agent-session/view/structured-agent-session-tab'
import type { AgentStatusEntry } from '../../../../shared/agent-status/contracts/agent-status-types'
import type { ExternalConversationLink } from '../../../../shared/connectors/external-conversation-link'
import { selectBotRowLine } from './bot-row-activity-line'

const NOW = 1_000_000_000_000
const MIN = 60_000

function session(sessionId: string, updatedAt: number, message: string): AgentStatusEntry {
  return {
    paneKey: structuredAgentSessionStatusPaneKey(sessionId),
    worktreeId: 'folder:bot-home',
    agentType: 'claude',
    prompt: 'the ask',
    stateStartedAt: updatedAt,
    stateHistory: [],
    state: 'done',
    updatedAt,
    lastAssistantMessage: message
  }
}

const slackLink: ExternalConversationLink = {
  source: 'slack',
  externalId: 'T1:slack-thread',
  sessionId: 'slack-thread',
  agent: 'claude',
  paneKey: structuredAgentSessionStatusPaneKey('slack-thread'),
  lastTurn: 'conversation',
  place: '#releases',
  createdAt: NOW - 60 * MIN
}

it('names the thread by its kept place, with the pane key of the chat it opens', () => {
  const entries = [
    session('chat', NOW - 30 * MIN, 'Older'),
    session('slack-thread', NOW - 2 * MIN, 'Cut v1.0.0')
  ]
  const line = selectBotRowLine(
    {
      paused: false,
      rows: buildWorktreeAgentRows({ tabs: [], entries, now: NOW }),
      chatSessionId: 'chat',
      links: [slackLink],
      waits: [],
      now: NOW
    },
    (_key, fallback) => fallback
  )
  expect(line).toMatchObject({
    kind: 'activity',
    place: {
      source: 'slack',
      label: '#releases',
      paneKey: structuredAgentSessionStatusPaneKey('slack-thread')
    },
    text: 'Cut v1.0.0'
  })
})
