import { describe, expect, it } from 'vitest'
import type { AgentSessionStatusSummary } from '../../../shared/agent-session/agent-session-wire'
import { listBusyChats } from './busy-chats'

function summary(overrides: Partial<AgentSessionStatusSummary>): AgentSessionStatusSummary {
  return {
    sessionId: 's1',
    workspaceId: 'repo-1::/Users/me/code/halibut',
    agent: 'claude',
    status: 'idle',
    hostExecutionOwned: true,
    latestPrompt: 'Fix the build',
    updatedAt: 1,
    ...overrides
  } as AgentSessionStatusSummary
}

describe('listBusyChats', () => {
  it('lists a working chat with its tool, name and workspace', () => {
    expect(
      listBusyChats([
        summary({ status: 'working', toolName: 'Bash', conversationName: 'Build fix' })
      ])
    ).toEqual([
      {
        sessionId: 's1',
        name: 'Build fix',
        workspace: 'halibut',
        activity: { kind: 'turn', toolName: 'Bash' }
      }
    ])
  })

  it('never lists idle chats or chats whose provider this app does not run', () => {
    expect(
      listBusyChats([
        summary({ status: 'idle' }),
        summary({ status: null }),
        summary({ status: 'working', hostExecutionOwned: undefined }),
        undefined
      ])
    ).toEqual([])
  })

  it('counts a chat waiting on a question as busy', () => {
    expect(listBusyChats([summary({ status: 'attention' })])[0]?.activity).toEqual({
      kind: 'question'
    })
  })

  it('counts live subagents and commands on an idle turn, not settled ones', () => {
    const chats = listBusyChats([
      summary({
        children: [
          { id: 'a', kind: 'agent', state: 'working', membership: 'live' },
          { id: 'b', kind: 'command', state: 'monitoring', membership: 'live' },
          { id: 'c', kind: 'agent', state: 'working', membership: 'settled' },
          { id: 'd', kind: 'agent', state: 'done', membership: 'live' }
        ] as AgentSessionStatusSummary['children']
      })
    ])
    expect(chats[0]?.activity).toEqual({ kind: 'children', subagents: 1, commands: 1 })
  })

  it('falls back to background tasks, treating a missing state as running', () => {
    const chats = listBusyChats([
      summary({
        backgroundTasks: [
          { id: 'a', kind: 'command' },
          { id: 'b', kind: 'command', state: 'done' }
        ]
      })
    ])
    expect(chats[0]?.activity).toEqual({ kind: 'children', subagents: 0, commands: 1 })
  })

  it('names an unnamed chat from its prompt, truncated', () => {
    const prompt = 'x'.repeat(80)
    expect(listBusyChats([summary({ status: 'working', latestPrompt: prompt })])[0]?.name).toBe(
      `${'x'.repeat(57)}...`
    )
  })
})
