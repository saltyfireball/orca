import { describe, expect, it } from 'vitest'
import type { AgentSessionStatusSummary } from '../../../shared/agent-session/agent-session-wire'
import { readLiveAgents } from './live-agents'

function host(summaries: Record<string, Partial<AgentSessionStatusSummary>>) {
  return {
    loadedSessionIds: () => Object.keys(summaries),
    readStatusSummary: (id: string) => summaries[id]
  }
}

describe('readLiveAgents', () => {
  it('counts only chats whose provider process this app runs, and agent terminals', () => {
    const live = readLiveAgents({
      host: host({
        running: { hostExecutionOwned: true },
        // A sleeping chat has no provider child: the flag is absent.
        sleeping: { conversationName: 'asleep' },
        released: {},
        worker: { hostExecutionOwned: true }
      }),
      ptys: new Map([
        ['p1', { ptyId: 'p1', connected: true, launchAgent: 'claude' }],
        [
          'p2',
          {
            ptyId: 'p2',
            connected: true,
            launchAgent: null,
            foregroundAgent: 'codex'
          }
        ],
        ['p3', { ptyId: 'p3', connected: true, launchAgent: null }],
        ['p4', { ptyId: 'p4', connected: false, launchAgent: 'claude' }]
      ]),
      workerKind: (id) => (id === 'worker' ? 'worker' : 'interactive')
    })
    expect(Object.fromEntries(live)).toEqual({
      running: 'interactive',
      worker: 'worker',
      'pty:p1': 'interactive',
      'pty:p2': 'interactive'
    })
  })

  it('reads nothing when no host or terminals exist yet', () => {
    expect(
      readLiveAgents({
        host: null,
        ptys: undefined,
        workerKind: () => 'interactive'
      }).size
    ).toBe(0)
  })
})
