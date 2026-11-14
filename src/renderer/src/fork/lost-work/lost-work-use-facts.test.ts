// SLRM-2230: what the window's own state says holds a workspace open.
import { describe, expect, it } from 'vitest'
import { structuredAgentSessionPaneKey } from '../../../../shared/agent-session/view/structured-agent-session-projection'
import { lostWorkUseByWorktree, type LostWorkUseFacts } from './lost-work-use-facts'

const NOW = 1_800_000_000_000

function facts(over: Partial<LostWorkUseFacts>): LostWorkUseFacts {
  return {
    activeWorktreeId: null,
    tabsByWorktree: {},
    unifiedTabsByWorktree: {},
    ptyIdsByTabId: {},
    agentStatusByPaneKey: {},
    sleepingAgentSessionsByPaneKey: {},
    ...over
  } as LostWorkUseFacts
}

function chatTab(id: string, sessionId: string) {
  return { id, entityId: sessionId, contentType: 'agent-session', agentSessionAgent: 'claude' }
}

describe('lostWorkUseByWorktree', () => {
  it('leaves out a workspace nothing holds', () => {
    expect(lostWorkUseByWorktree(facts({}), ['w1'], NOW).size).toBe(0)
  })

  it('counts open chats, and a settled chat with no provider as asleep', () => {
    const asleep = structuredAgentSessionPaneKey('t2', 's2')
    const uses = lostWorkUseByWorktree(
      facts({
        unifiedTabsByWorktree: {
          w1: [chatTab('t1', 's1'), chatTab('t2', 's2'), { id: 't3', contentType: 'terminal' }]
        },
        agentStatusByPaneKey: { [asleep]: { state: 'done' } }
      } as unknown as Partial<LostWorkUseFacts>),
      ['w1'],
      NOW
    )
    expect(uses.get('w1')).toEqual({
      agentRunning: false,
      openChats: 1,
      sleepingChats: 1,
      liveTerminals: 0,
      active: false
    })
  })

  it('counts terminals with a live PTY, slept agents and the workspace on screen', () => {
    const uses = lostWorkUseByWorktree(
      facts({
        activeWorktreeId: 'w2',
        tabsByWorktree: { w1: [{ id: 'a' }, { id: 'b' }] },
        ptyIdsByTabId: { a: ['pty-1'], b: [] },
        sleepingAgentSessionsByPaneKey: {
          p1: { worktreeId: 'w3', origin: 'worktree-sleep' },
          p2: { worktreeId: 'w3', origin: 'quit' }
        }
      } as unknown as Partial<LostWorkUseFacts>),
      ['w1', 'w2', 'w3', 'w4'],
      NOW
    )
    expect(uses.get('w1')?.liveTerminals).toBe(1)
    expect(uses.get('w2')?.active).toBe(true)
    expect(uses.get('w3')?.sleepingChats).toBe(1)
    expect(uses.has('w4')).toBe(false)
  })

  it('marks a workspace whose agent works', () => {
    const uses = lostWorkUseByWorktree(
      facts({
        tabsByWorktree: { w1: [{ id: 'a' }] },
        agentStatusByPaneKey: {
          'a:leaf': {
            paneKey: 'a:leaf',
            worktreeId: 'w1',
            state: 'working',
            prompt: '',
            updatedAt: NOW,
            stateStartedAt: NOW
          }
        }
      } as unknown as Partial<LostWorkUseFacts>),
      ['w1'],
      NOW
    )
    expect(uses.get('w1')?.agentRunning).toBe(true)
  })
})
