// Sleepers (FORK.md): turning a runtime's agent rows into sleeper sources.
import { describe, expect, it } from 'vitest'
import type { RuntimeWorktreeAgentRow } from '../runtime-worktree-contracts'
import { structuredAgentSessionTabId } from '../agent-session/view/structured-agent-session-projection'
import { sleeperChatSessionId, sleeperSourcesFromPs, sleeperTitle } from './sleepers-ps-sources'

function agent(over: Partial<RuntimeWorktreeAgentRow>): RuntimeWorktreeAgentRow {
  return {
    paneKey: 'tab-1:leaf-1',
    agentType: 'claude',
    state: 'done',
    prompt: 'fix the build',
    stateStartedAt: 100,
    updatedAt: 200,
    ...over
  } as RuntimeWorktreeAgentRow
}

const chatPane = `${structuredAgentSessionTabId('sess-1')}:leaf-1`

describe('sleeperChatSessionId', () => {
  it('reads a chat pane key and ignores terminal panes', () => {
    expect(sleeperChatSessionId(chatPane)).toBe('sess-1')
    expect(sleeperChatSessionId(structuredAgentSessionTabId('sess-2'))).toBe('sess-2')
    expect(sleeperChatSessionId('tab-1:leaf-1')).toBeNull()
  })
})

describe('sleeperTitle', () => {
  it('prefers the conversation name, then display name, task, prompt and agent', () => {
    expect(sleeperTitle(agent({ conversationName: ' Plan ', displayName: 'x' }))).toBe('Plan')
    expect(sleeperTitle(agent({ displayName: 'Shown' }))).toBe('Shown')
    expect(sleeperTitle(agent({ taskTitle: 'Task' }))).toBe('Task')
    expect(sleeperTitle(agent({}))).toBe('fix the build')
    expect(sleeperTitle(agent({ prompt: '  ' }))).toBe('claude')
  })
})

describe('sleeperSourcesFromPs', () => {
  it('names chats by session id and terminals by pane key, skipping subagents', () => {
    const sources = sleeperSourcesFromPs(
      [
        {
          worktreeId: 'w1',
          displayName: 'alpha',
          repo: 'repo',
          agents: [
            agent({ paneKey: chatPane }),
            agent({ paneKey: 'tab-2:leaf-1', state: 'working' }),
            agent({ paneKey: 'tab-3:leaf-1', parentPaneKey: 'tab-2:leaf-1' })
          ]
        }
      ],
      new Map([['sess-1', { model: 'opus' }]])
    )
    expect(sources).toHaveLength(2)
    expect(sources[0]).toMatchObject({
      id: 'sess-1',
      kind: 'chat',
      model: 'opus',
      processAlive: true,
      local: true,
      workspace: 'alpha'
    })
    expect(sources[1]).toMatchObject({
      id: 'tab-2:leaf-1',
      kind: 'terminal',
      processAlive: true,
      local: true
    })
  })

  it('reads a chat with no running provider as asleep and a remote host as not local', () => {
    const sources = sleeperSourcesFromPs(
      [
        {
          worktreeId: 'w2',
          displayName: '',
          repo: 'repo',
          hostId: 'runtime:other',
          agents: [agent({ paneKey: chatPane }), agent({ paneKey: 'tab-9:leaf-1' })]
        }
      ],
      new Map()
    )
    expect(sources[0]).toMatchObject({ kind: 'chat', processAlive: false, local: false })
    expect(sources[0].workspace).toBe('repo')
    // A finished terminal agent with no live PTY has nothing left to sleep.
    expect(sources[1]).toMatchObject({ kind: 'terminal', processAlive: false, local: false })
  })

  it('counts a chat the runtime says its host owns as awake', () => {
    const [chat] = sleeperSourcesFromPs(
      [
        {
          worktreeId: 'w',
          displayName: 'a',
          repo: 'r',
          agents: [agent({ paneKey: chatPane, structuredHostOwned: true })]
        }
      ],
      new Map()
    )
    expect(chat.processAlive).toBe(true)
  })
})
