import { beforeEach, describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status/contracts/agent-status-types'
import { _resetChildTallyCacheForTest } from './agent-child-tally'
import {
  _resetChildTallyStoreCacheForTest,
  childTallyRootKey,
  selectAgentChildTally
} from './use-agent-child-tally'

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

type SelectorState = Parameters<typeof selectAgentChildTally>[0]

function state(settings: Record<string, boolean> = {}, updatedAt = 1): SelectorState {
  const fields = {
    settings,
    agentStatusByPaneKey: { coord: entry('coord', { updatedAt }), w1: entry('w1') },
    retainedAgentsByPaneKey: {},
    runtimeAgentOrchestrationByPaneKey: RUNTIME,
    tabsByWorktree: {}
  }
  // The selector reads only these slices; the rest of the store is irrelevant here.
  return fields as unknown as SelectorState
}

const RUNTIME = {
  w1: {
    taskId: 't1',
    dispatchId: 'd1',
    dispatchStatus: 'dispatched' as const,
    parentPaneKey: 'coord'
  },
  w2: {
    taskId: 't2',
    dispatchId: 'd2',
    dispatchStatus: 'completed' as const,
    parentPaneKey: 'coord'
  }
}

beforeEach(() => {
  _resetChildTallyCacheForTest()
  _resetChildTallyStoreCacheForTest()
})

describe('selectAgentChildTally', () => {
  it('counts running and total by default, and nothing when the badge is off', () => {
    expect(selectAgentChildTally(state(), 'coord')).toMatchObject({ running: 1, total: 2 })
    expect(selectAgentChildTally(state({ forkShowChildTally: false }), 'coord').total).toBe(0)
    expect(
      selectAgentChildTally(state({ forkChildTallyCountFinished: false }), 'coord')
    ).toMatchObject({ running: 1, total: 1 })
  })

  it('hands back the same object when an unrelated status update changes nothing it shows', () => {
    const first = selectAgentChildTally(state({}, 1), 'coord')
    expect(selectAgentChildTally(state({}, 2), 'coord')).toBe(first)
  })

  it('joins roots without the NUL that synthetic sub-agent keys use', () => {
    expect(childTallyRootKey(['a', 'b'])).not.toContain('\u0000')
    expect(selectAgentChildTally(state(), childTallyRootKey(['coord', 'w1']))).toMatchObject({
      total: 1
    })
  })
})
