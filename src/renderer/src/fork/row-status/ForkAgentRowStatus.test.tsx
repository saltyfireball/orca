/** @vitest-environment happy-dom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { ForkCacheState } from '../../../../shared/fork/usage-ledger'
import { forkRowStatusConfig } from '../../../../shared/fork/row-status'
import { translate } from '@/i18n/i18n'
import { structuredAgentSessionPaneKey } from '../../../../shared/agent-session/view/structured-agent-session-projection'

const review = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('./use-fork-row-review', () => ({
  useForkRowReview: (_worktreeId: string, enabled: boolean) => ({
    review: enabled ? review.current : null,
    repo: undefined
  })
}))
const ai = vi.hoisted(() => ({ enabled: true }))
vi.mock('../../../../shared/source-control/ai/source-control-ai-operation-policy', () => ({
  resolveSourceControlAiEnabled: () => ai.enabled
}))
const ask = vi.hoisted(() => vi.fn(async () => true))
vi.mock('./fork-row-fix-checks', () => ({ forkAskAgentToFixChecks: ask }))

const { ForkAgentRowStatus, forkSpendText } = await import('./ForkAgentRowStatus')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const initial = useAppStore.getState()
let root: Root | undefined
let push: ((states: ForkCacheState[]) => void) | undefined

const ROW = {
  paneKey: structuredAgentSessionPaneKey('tab-1', 'sess-1'),
  tab: { id: 'tab-1', worktreeId: 'repo-1::/w' },
  rowSource: 'agent'
}

function seed(settings: Partial<AppState['settings']> = {}): void {
  useAppStore.setState({
    settings: { ...initial.settings, ...settings } as AppState['settings'],
    unifiedTabsByWorktree: {
      'repo-1::/w': [
        { id: 'tab-1', contentType: 'agent-session', entityId: 'sess-1' }
      ] as unknown as AppState['unifiedTabsByWorktree'][string]
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

function chips(container: HTMLElement): Record<string, string> {
  return Object.fromEntries(
    [...container.querySelectorAll('[data-fork-row-status]')].map((node) => [
      node.getAttribute('data-fork-row-status') ?? '',
      node.textContent ?? ''
    ])
  )
}

beforeEach(() => {
  review.current = null
  ai.enabled = true
  ask.mockClear()
  ;(window as unknown as { api: unknown }).api = {
    forkUsageLedger: {
      cacheStates: async () => [],
      onCacheChanged: (callback: (states: ForkCacheState[]) => void) => {
        push = callback
        return () => {
          push = undefined
        }
      }
    }
  }
})

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
  useAppStore.setState(initial, true)
})

const STATE: ForkCacheState = {
  sessionId: 'sess-1',
  lastAt: 1,
  contextTokens: 142_300,
  working: false,
  costUsd: 1.234,
  billing: 'api'
}

describe('ForkAgentRowStatus', () => {
  it('shows the chat spend and context from the ledger push', () => {
    seed()
    const container = render(<ForkAgentRowStatus agent={ROW} />)
    expect(chips(container)).toEqual({})
    act(() => push?.([STATE]))
    expect(chips(container)).toEqual({ spend: '$1.23', context: 'ctx 142.3k' })
  })

  it('turns each part off with its setting, and shows nothing on sub-agent rows', () => {
    seed({ forkRowSpend: false })
    const container = render(<ForkAgentRowStatus agent={ROW} />)
    act(() => push?.([STATE]))
    expect(chips(container)).toEqual({ context: 'ctx 142.3k' })
    act(() => root?.unmount())
    seed({ forkRowContext: false })
    const sub = render(<ForkAgentRowStatus agent={{ ...ROW, rowSource: 'subagent' }} />)
    act(() => push?.([STATE]))
    expect(chips(sub)).toEqual({})
  })

  it('shows the PR chip and, while its checks fail, a Fix button that asks this agent', () => {
    seed({ forkRowSpend: false, forkRowContext: false })
    review.current = {
      provider: 'github',
      number: 42,
      title: 'Add a thing',
      state: 'open',
      url: 'https://github.com/o/r/pull/42',
      status: 'failure'
    }
    const container = render(<ForkAgentRowStatus agent={ROW} />)
    expect(chips(container)).toMatchObject({ pr: '#42' })
    const fix = container.querySelector<HTMLButtonElement>('[data-fork-row-status="fix"]')
    expect(fix).not.toBeNull()
    act(() => fix!.click())
    expect(ask).toHaveBeenCalledWith(ROW)
    act(() => root?.unmount())
    // The stock switch that hides the Checks panel's AI actions hides this button too.
    ai.enabled = false
    expect('fix' in chips(render(<ForkAgentRowStatus agent={ROW} />))).toBe(false)
  })

  it('hides the Fix button when checks pass or the setting is off', () => {
    review.current = {
      provider: 'github',
      number: 42,
      title: 'Add a thing',
      state: 'open',
      status: 'success'
    }
    seed()
    expect(chips(render(<ForkAgentRowStatus agent={ROW} />))).toEqual({ pr: '#42' })
    act(() => root?.unmount())
    review.current = { ...(review.current as object), status: 'failure' }
    seed({ forkRowFixChecks: false })
    expect('fix' in chips(render(<ForkAgentRowStatus agent={ROW} />))).toBe(false)
  })
})

describe('forkSpendText', () => {
  it('marks a subscription estimate and an unpriced floor', () => {
    expect(forkSpendText({ costUsd: 2, billing: 'subscription' }, translate)?.text).toBe('~$2.00')
    expect(forkSpendText({ costUsd: 0.001, unpriced: true }, translate)?.text).toBe('<$0.01+')
    expect(forkSpendText({}, translate)).toBeNull()
  })
})

describe('forkRowStatusConfig', () => {
  it('ships every part on, and the fix button goes with the PR chip', () => {
    expect(forkRowStatusConfig(undefined)).toEqual({
      spend: true,
      context: true,
      pr: true,
      fix: true
    })
    expect(forkRowStatusConfig({ forkRowPrChip: false }).fix).toBe(false)
  })
})
