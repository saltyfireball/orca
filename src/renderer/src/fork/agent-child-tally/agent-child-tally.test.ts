import { beforeEach, describe, expect, it } from 'vitest'
import type {
  AgentStatusEntry,
  AgentStatusOrchestrationContext
} from '../../../../shared/agent-status/contracts/agent-status-types'
import type { AgentChildWorkView } from '../../../../shared/agent-status/child-work/agent-status-child-work-view'
import {
  _resetChildTallyCacheForTest,
  childTallySignature,
  tallyAgentChildren,
  type ChildTallyOptions,
  type ChildTallySources
} from './agent-child-tally'

const ALL: ChildTallyOptions = { countFinished: true, countTasks: true }

function entry(paneKey: string, extra: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    state: 'working',
    prompt: '',
    updatedAt: 1,
    stateStartedAt: 1,
    paneKey,
    stateHistory: [],
    ...extra
  }
}

function child(
  id: string,
  kind: AgentChildWorkView['kind'],
  settled: boolean,
  extra: Partial<AgentChildWorkView> = {}
): AgentChildWorkView {
  return {
    id,
    providerId: `p-${id}`,
    kind,
    name: id,
    state: settled ? 'done' : 'working',
    membership: settled ? 'settled' : 'live',
    ...(settled ? { outcome: 'succeeded' as const, settledAt: 2 } : {}),
    firstObservedAt: 1,
    observedAt: 1,
    stoppable: false,
    invocation: { invocationId: `i-${id}`, generation: 1 },
    ...extra
  }
}

function worker(
  parentPaneKey: string | undefined,
  dispatchStatus: AgentStatusOrchestrationContext['dispatchStatus'],
  name: string,
  extra: Partial<AgentStatusOrchestrationContext> = {}
): AgentStatusOrchestrationContext {
  return {
    taskId: `task-${name}`,
    dispatchId: `d-${name}`,
    dispatchStatus,
    displayName: name,
    ...(parentPaneKey ? { parentPaneKey } : {}),
    ...extra
  }
}

function sources(
  contexts: Record<string, AgentStatusOrchestrationContext>,
  entries: AgentStatusEntry[]
): ChildTallySources {
  const byPane = new Map(entries.map((e) => [e.paneKey, e]))
  return { contexts, entryFor: (paneKey) => byPane.get(paneKey), entries: () => entries }
}

beforeEach(() => {
  _resetChildTallyCacheForTest()
})

describe('tallyAgentChildren', () => {
  it('counts workers that live in other worktrees through their parent pane', () => {
    const coordinator = entry('wtA:tab1:leaf1')
    const s = sources(
      {
        'wtB:tab2:leaf1': worker('wtA:tab1:leaf1', 'dispatched', 'Lane A'),
        'wtC:tab3:leaf1': worker('wtA:tab1:leaf1', 'completed', 'Lane B'),
        'wtD:tab4:leaf1': worker('someone-else', 'dispatched', 'Not mine')
      },
      [coordinator, entry('wtB:tab2:leaf1', { state: 'waiting' })]
    )
    const tally = tallyAgentChildren(['wtA:tab1:leaf1'], s, ALL)
    expect(tally).toMatchObject({ running: 1, total: 2, direct: 2 })
    expect(tally.items.map((i) => [i.name, i.kind, i.state, i.running])).toEqual([
      ['Lane A', 'worker', 'waiting', true],
      ['Lane B', 'worker', 'done', false]
    ])
  })

  it('walks a worker that dispatched its own workers, and its sub-agents', () => {
    const s = sources(
      {
        lead: worker('coord', 'dispatched', 'Lead'),
        leaf: worker('lead', 'dispatched', 'Leaf')
      },
      [
        entry('coord'),
        entry('lead', { children: [child('reviewer', 'agent', false)] }),
        entry('leaf', { state: 'done' })
      ]
    )
    const tally = tallyAgentChildren(['coord'], s, ALL)
    expect(tally.items.map((i) => [i.name, i.depth, i.state])).toEqual([
      ['Lead', 1, 'working'],
      ['reviewer', 2, 'working'],
      // An open dispatch whose turn ended is still the coordinator's.
      ['Leaf', 2, 'idle']
    ])
    expect(tally).toMatchObject({ running: 3, total: 3, direct: 1 })
  })

  it('finds a parent named only by terminal handle', () => {
    const s = sources({ w: worker(undefined, 'pending', 'W', { coordinatorHandle: 'term_1' }) }, [
      entry('coord', { terminalHandle: 'term_1' })
    ])
    expect(tallyAgentChildren(['coord'], s, ALL).items).toMatchObject([
      { name: 'W', state: 'idle', running: true }
    ])
  })

  it('counts sub-agents and background tasks, nested ones too', () => {
    const s = sources({}, [
      entry('chat', {
        children: [
          child('explore', 'agent', false),
          child('npm test', 'command', true),
          child('nested', 'agent', false, { parentChildWorkId: 'explore' }),
          child('watch', 'monitor', false)
        ]
      })
    ])
    const tally = tallyAgentChildren(['chat'], s, ALL)
    expect(tally.items.map((i) => [i.name, i.kind, i.depth, i.running])).toEqual([
      ['explore', 'subagent', 1, true],
      ['nested', 'subagent', 2, true],
      ['npm test', 'task', 1, false],
      ['watch', 'task', 1, true]
    ])
    expect(tally).toMatchObject({ running: 3, total: 4, direct: 3 })
  })

  it('reads legacy subagent snapshots when the host publishes no child views', () => {
    const s = sources({}, [
      entry('chat', {
        subagents: [{ id: 'a1', state: 'working', agentType: 'Explore', startedAt: 1 }]
      })
    ])
    expect(tallyAgentChildren(['chat'], s, ALL).items).toMatchObject([
      { kind: 'subagent', running: true }
    ])
  })

  it('drops finished children or tasks when the settings say so', () => {
    const s = sources({ w: worker('chat', 'completed', 'Done worker') }, [
      entry('chat', {
        children: [child('a', 'agent', false), child('sh', 'command', false)]
      })
    ])
    expect(
      tallyAgentChildren(['chat'], s, { countFinished: false, countTasks: true })
    ).toMatchObject({ running: 2, total: 2 })
    expect(
      tallyAgentChildren(['chat'], s, { countFinished: true, countTasks: false })
    ).toMatchObject({ running: 1, total: 2 })
  })

  it('counts a child once across several roots and survives a parent cycle', () => {
    const s = sources(
      {
        a: worker('b', 'dispatched', 'A'),
        b: worker('a', 'dispatched', 'B'),
        c: worker('a', 'dispatched', 'C')
      },
      [entry('a'), entry('b'), entry('c')]
    )
    const tally = tallyAgentChildren(['a', 'b'], s, ALL)
    expect(tally.items.map((i) => i.name)).toEqual(['C'])
  })

  it('returns the shared empty tally and a stable signature', () => {
    const s = sources({}, [entry('lonely')])
    const empty = tallyAgentChildren(['lonely'], s, ALL)
    expect(empty.total).toBe(0)
    expect(tallyAgentChildren(['lonely'], s, ALL)).toBe(empty)
    const withChild = sources({}, [entry('x', { children: [child('a', 'agent', false)] })])
    expect(childTallySignature(tallyAgentChildren(['x'], withChild, ALL))).toBe(
      childTallySignature(tallyAgentChildren(['x'], withChild, ALL))
    )
  })
})
