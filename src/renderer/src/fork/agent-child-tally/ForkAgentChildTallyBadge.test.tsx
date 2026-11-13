/** @vitest-environment happy-dom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { _resetChildTallyCacheForTest } from './agent-child-tally'
import { _resetChildTallyStoreCacheForTest } from './use-agent-child-tally'
import { ForkAgentRowChildTally, ForkAgentStripChildTally } from './ForkAgentChildTallyBadge'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const initial = useAppStore.getState()
let root: Root | undefined

function seed(settings: Partial<AppState['settings']> = {}): void {
  const entry = (paneKey: string) => ({
    state: 'working' as const,
    prompt: '',
    updatedAt: 1,
    stateStartedAt: 1,
    paneKey,
    stateHistory: []
  })
  useAppStore.setState({
    settings: { ...initial.settings, ...settings } as AppState['settings'],
    agentStatusByPaneKey: { coord: entry('coord'), other: entry('other') },
    retainedAgentsByPaneKey: {},
    runtimeAgentOrchestrationByPaneKey: {
      w1: { taskId: 't1', dispatchId: 'd1', dispatchStatus: 'dispatched', parentPaneKey: 'coord' },
      w2: { taskId: 't2', dispatchId: 'd2', dispatchStatus: 'completed', parentPaneKey: 'coord' },
      w3: { taskId: 't3', dispatchId: 'd3', dispatchStatus: 'dispatched', parentPaneKey: 'other' }
    }
  })
}

function render(node: React.ReactNode): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<TooltipProvider>{node}</TooltipProvider>))
  return container
}

function badge(container: HTMLElement): string | null {
  return (
    container.querySelector('[data-fork-child-tally]')?.getAttribute('data-fork-child-tally') ??
    null
  )
}

beforeEach(() => {
  _resetChildTallyCacheForTest()
  _resetChildTallyStoreCacheForTest()
})

afterEach(() => {
  act(() => root?.unmount())
  document.body.replaceChildren()
  useAppStore.setState(initial, true)
})

describe('ForkAgentRowChildTally', () => {
  it('shows running/total for a coordinator row and nothing for a sub-agent row', () => {
    seed()
    expect(badge(render(<ForkAgentRowChildTally agent={{ paneKey: 'coord' }} />))).toBe('1/2')
    act(() => root?.unmount())
    expect(
      badge(render(<ForkAgentRowChildTally agent={{ paneKey: 'coord', rowSource: 'subagent' }} />))
    ).toBeNull()
  })

  it('follows the settings', () => {
    seed({ forkChildTallyCountFinished: false })
    expect(badge(render(<ForkAgentRowChildTally agent={{ paneKey: 'coord' }} />))).toBe('1')
    act(() => root?.unmount())
    seed({ forkShowChildTally: false })
    expect(badge(render(<ForkAgentRowChildTally agent={{ paneKey: 'coord' }} />))).toBeNull()
  })

  it('sums the collapsed strip across the card agents', () => {
    seed()
    const container = render(
      <ForkAgentStripChildTally agents={[{ paneKey: 'coord' }, { paneKey: 'other' }]} />
    )
    expect(badge(container)).toBe('2/3')
  })
})
