import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../agent-status/contracts/agent-status-types'
import type { BotSessionActivityRow, BotWorkerRow } from '../bots/bot-activity-model'
import { botNow } from '../bots/bot-now'
import { structuredAgentSessionStatusPaneKey } from '../agent-session/view/structured-agent-session-tab'
import { forkBotWaitingChats, type ForkBotWaitingChatsInput } from './bot-waiting-chats'

const HOME = 'folder:bot-home'

function asks(paneKey: string, prompt = 'Tidy the docs'): AgentStatusEntry {
  return {
    paneKey,
    state: 'blocked',
    prompt,
    updatedAt: 1,
    stateStartedAt: 1,
    stateHistory: [],
    worktreeId: HOME,
    agentType: 'claude'
  }
}
const chatAsks = (sessionId: string, prompt?: string) =>
  asks(structuredAgentSessionStatusPaneKey(sessionId), prompt)

function worker(fields: Partial<BotWorkerRow>): BotWorkerRow {
  return {
    kind: 'worker',
    key: 'worker:d1',
    dispatchId: 'd1',
    title: 'Docs worker',
    dot: 'working',
    origin: { kind: 'chat' },
    paneKey: null,
    workspaceId: null,
    at: 1,
    worker: null,
    ...fields
  }
}

/** The bot's own count: what `useBotNow` builds from the same parts. */
function needs(input: Partial<ForkBotWaitingChatsInput>, homeAsks = false) {
  const activity = input.activity ?? { workers: [], inProgress: [] }
  const { sideChats, panes } = forkBotWaitingChats({
    asking: [],
    chatSessionId: 'home',
    homeWorkspaceId: HOME,
    chats: [],
    waitingSideChats: [],
    ...input,
    activity
  })
  return botNow({
    activity: { ...activity, workers: [...activity.workers, ...panes], automations: [] },
    chatState: homeAsks ? 'blocked' : null,
    waitingSideChats: sideChats
  }).needs.map((need) =>
    need.kind === 'side-chat' ? `${need.kind}:${need.sessionId}:${need.title}` : need.key
  )
}

describe('forkBotWaitingChats (BAD-795)', () => {
  it('lists a waiting chat no other need speaks for, by its title or its prompt', () => {
    expect(
      needs({
        asking: [chatAsks('a'), chatAsks('b', 'Tidy the docs')],
        chats: [{ chatId: 'a', title: 'Release notes' }]
      })
    ).toEqual(['side-chat:a:Release notes', 'side-chat:b:Tidy the docs'])
  })

  it('counts the Home chat and a side chat the tree already lists once', () => {
    expect(
      needs(
        {
          asking: [chatAsks('home'), chatAsks('a')],
          waitingSideChats: [{ sessionId: 'a', title: 'Release notes' }]
        },
        true
      )
    ).toEqual(['chat', 'side-chat:a:Release notes'])
  })

  it('knows a chat a /clear moved on by its first id', () => {
    expect(
      needs({
        asking: [chatAsks('a-2')],
        chats: [{ chatId: 'a', liveSessionId: 'a-2', title: 'Release notes' }]
      })
    ).toEqual(['side-chat:a:Release notes'])
  })

  it('leaves threads, runs and workers to their own rows', () => {
    const thread: BotSessionActivityRow = {
      kind: 'thread',
      key: 'thread:t1',
      title: 'Thread',
      source: 'slack',
      dot: 'blocked',
      sessionId: 't1',
      at: 1
    }
    expect(
      needs({
        asking: [chatAsks('t1'), asks('tab-1:leaf-1')],
        activity: { workers: [worker({ paneKey: 'tab-1:leaf-1' })], inProgress: [thread] }
      })
    ).toEqual(['thread:t1'])
  })

  it('lists a terminal agent in the home that asks, with the pane a click opens', () => {
    const { panes } = forkBotWaitingChats({
      asking: [asks('tab-2:leaf-2')],
      chatSessionId: 'home',
      homeWorkspaceId: HOME,
      activity: { workers: [], inProgress: [] },
      chats: [],
      waitingSideChats: []
    })
    expect(panes).toMatchObject([
      { paneKey: 'tab-2:leaf-2', workspaceId: HOME, title: 'Tidy the docs', dot: 'blocked' }
    ])
    expect(needs({ asking: [asks('tab-2:leaf-2')] })).toEqual(['agent:local:tab-2:leaf-2'])
  })

  it('keeps the parts it was given while nothing else waits', () => {
    const waitingSideChats = [{ sessionId: 'a', title: 'A' }]
    const result = forkBotWaitingChats({
      asking: [],
      chatSessionId: null,
      homeWorkspaceId: HOME,
      activity: { workers: [], inProgress: [] },
      chats: [],
      waitingSideChats
    })
    expect(result.sideChats).toBe(waitingSideChats)
    expect(result.panes).toEqual([])
  })
})
