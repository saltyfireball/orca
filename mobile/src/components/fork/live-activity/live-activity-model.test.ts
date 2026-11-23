import { describe, expect, it } from 'vitest'
import type { AgentListStatus } from '../../../../../src/shared/agent-status/presentation/agent-list-status'
import type { RuntimeWorktreeAgentRow } from '../../../../../src/shared/worktree/catalog/runtime-worktree-contracts'
import type { AgentListInput } from '../../../agents/agent-list-rows'
import type { HomeAgentEntry, HostWorktreeInfo } from '../../../worktree/catalog/home-worktree-info'
import {
  EMPTY_LIVE_AGENT_MEMORY,
  foldLiveAgents,
  liveAgentSnapshot,
  nextLiveAgentExpiry,
  parseLiveAgentMemory,
  sameLiveAgentContent,
  type LiveAgentMemory
} from './live-activity-model'

const MINUTE = 60_000
const KEEP = 15 * MINUTE
const NAMES = { a: 'Studio', b: 'alpha' }

function agent(paneKey: string, status: AgentListStatus, sortAt: number): HomeAgentEntry {
  const row = {
    paneKey,
    parentPaneKey: null,
    state: 'working',
    agentType: 'claude',
    prompt: '',
    taskTitle: null,
    displayName: null,
    lastAssistantMessage: null,
    toolName: null,
    toolInput: null,
    interrupted: false,
    stateStartedAt: sortAt,
    updatedAt: sortAt,
    activity: {
      listed: true,
      status,
      unread: false,
      clearable: false,
      sortAt,
      title: `Task ${paneKey}`
    }
  } as RuntimeWorktreeAgentRow
  return { worktreeId: 'wt', workspaceName: 'web', repo: 'web', branch: 'main', agent: row }
}

function input(
  now: number,
  agents: Partial<Record<'a' | 'b', HomeAgentEntry[]>>,
  connected: readonly ('a' | 'b')[] = ['a', 'b']
): AgentListInput {
  const worktreeInfo: Record<string, HostWorktreeInfo> = {}
  for (const hostId of ['a', 'b'] as const) {
    worktreeInfo[hostId] = {
      hostId,
      totalWorktrees: 1,
      activeCount: 1,
      agents: agents[hostId] ?? []
    }
  }
  return {
    hosts: [{ id: 'a' }, { id: 'b' }],
    hostStates: {
      a: connected.includes('a') ? 'connected' : 'disconnected',
      b: connected.includes('b') ? 'connected' : 'disconnected'
    },
    worktreeInfo,
    now
  }
}

describe('foldLiveAgents', () => {
  it('lists working and needs-you agents from every server, leaving idle ones out', () => {
    const memory = foldLiveAgents(
      EMPTY_LIVE_AGENT_MEMORY,
      input(10 * MINUTE, {
        a: [agent('p1', 'working', MINUTE), agent('p2', 'idle', MINUTE)],
        b: [agent('p3', 'waiting', 2 * MINUTE)]
      }),
      NAMES,
      KEEP
    )
    expect(memory.rows.map((row) => [row.id, row.state, row.host])).toEqual([
      ['b:p3', 'needs-you', 'alpha'],
      ['a:p1', 'working', 'Studio']
    ])
  })

  it('keeps a finished agent for the chosen minutes, from when it was seen to finish', () => {
    const running = foldLiveAgents(
      EMPTY_LIVE_AGENT_MEMORY,
      input(MINUTE, { a: [agent('p1', 'working', 0)] }),
      NAMES,
      KEEP
    )
    const finished = foldLiveAgents(
      running,
      input(5 * MINUTE, { a: [agent('p1', 'done', 0)] }),
      NAMES,
      KEEP
    )
    expect(finished.rows[0]).toMatchObject({
      state: 'done',
      since: 5 * MINUTE,
      expiresAt: 20 * MINUTE
    })
    expect(nextLiveAgentExpiry(finished)).toBe(20 * MINUTE)
    const later = (at: number) =>
      foldLiveAgents(finished, input(at, { a: [agent('p1', 'done', 0)] }), NAMES, KEEP)
    expect(later(19 * MINUTE).rows).toHaveLength(1)
    expect(later(20 * MINUTE).rows).toHaveLength(0)
  })

  it('counts an agent seen working that now reads idle as finished', () => {
    const running = foldLiveAgents(
      EMPTY_LIVE_AGENT_MEMORY,
      input(MINUTE, { a: [agent('p1', 'working', 0)] }),
      NAMES,
      KEEP
    )
    const after = foldLiveAgents(
      running,
      input(2 * MINUTE, { a: [agent('p1', 'idle', 0)] }),
      NAMES,
      KEEP
    )
    expect(after.rows[0]).toMatchObject({ state: 'done', since: 2 * MINUTE })
  })

  it('drops a finished agent first seen after its minutes were already up', () => {
    const memory = foldLiveAgents(
      EMPTY_LIVE_AGENT_MEMORY,
      input(60 * MINUTE, { a: [agent('p1', 'done', 10 * MINUTE)] }),
      NAMES,
      KEEP
    )
    expect(memory.rows).toEqual([])
  })

  it('keeps what a disconnected server last showed, and forgets an unpaired one', () => {
    const both = foldLiveAgents(
      EMPTY_LIVE_AGENT_MEMORY,
      input(MINUTE, { a: [agent('p1', 'working', 0)], b: [agent('p3', 'working', 0)] }),
      NAMES,
      KEEP
    )
    const bOffline = foldLiveAgents(both, input(2 * MINUTE, { a: [] }, ['a']), NAMES, KEEP)
    expect(bOffline.rows.map((row) => row.id)).toEqual(['b:p3'])
    const unpaired = foldLiveAgents(
      bOffline,
      { ...input(3 * MINUTE, { a: [] }, ['a']), hosts: [{ id: 'a' }] },
      NAMES,
      KEEP
    )
    expect(unpaired.rows).toEqual([])
  })

  it('clips long titles so the content state stays small', () => {
    const long = agent('p1', 'working', 0)
    const entry = {
      ...long,
      agent: { ...long.agent, activity: { ...long.agent.activity!, title: 'x'.repeat(200) } }
    } as HomeAgentEntry
    const memory = foldLiveAgents(
      EMPTY_LIVE_AGENT_MEMORY,
      input(MINUTE, { a: [entry] }),
      NAMES,
      KEEP
    )
    expect(memory.rows[0]!.title).toHaveLength(60)
  })
})

describe('liveAgentSnapshot', () => {
  const memory: LiveAgentMemory = {
    rows: [
      {
        id: 'a:1',
        hostId: 'a',
        paneKey: '1',
        title: 'one',
        host: 'Studio',
        workspace: 'w',
        state: 'needs-you',
        since: 1
      },
      {
        id: 'a:2',
        hostId: 'a',
        paneKey: '2',
        title: 'two',
        host: 'Studio',
        workspace: 'w',
        state: 'failed',
        since: 2,
        expiresAt: 9
      },
      {
        id: 'a:3',
        hostId: 'a',
        paneKey: '3',
        title: 'three',
        host: 'Studio',
        workspace: 'w',
        state: 'working',
        since: 3
      },
      {
        id: 'a:4',
        hostId: 'a',
        paneKey: '4',
        title: 'four',
        host: 'Studio',
        workspace: 'w',
        state: 'done',
        since: 4,
        expiresAt: 9
      }
    ]
  }

  it('counts every row but lists only the first ones, without routing fields', () => {
    const snapshot = liveAgentSnapshot(memory, 2, 100)
    expect(snapshot).toMatchObject({ working: 1, needsYou: 2, done: 1, updatedAt: 100 })
    expect(snapshot.rows.map((row) => row.id)).toEqual(['a:1', 'a:2'])
    expect(snapshot.rows[0]).not.toHaveProperty('paneKey')
  })

  it('treats snapshots that differ only in their time as the same', () => {
    expect(
      sameLiveAgentContent(liveAgentSnapshot(memory, 4, 1), liveAgentSnapshot(memory, 4, 2))
    ).toBe(true)
    expect(sameLiveAgentContent(null, liveAgentSnapshot(memory, 4, 2))).toBe(false)
  })

  it('reads back what it stored and drops malformed rows', () => {
    expect(parseLiveAgentMemory(JSON.stringify(memory))).toEqual(memory)
    expect(parseLiveAgentMemory('{"rows":[{"id":1}]}')).toEqual(EMPTY_LIVE_AGENT_MEMORY)
    expect(parseLiveAgentMemory('nope')).toEqual(EMPTY_LIVE_AGENT_MEMORY)
    expect(parseLiveAgentMemory(null)).toEqual(EMPTY_LIVE_AGENT_MEMORY)
  })
})
