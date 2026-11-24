/** @vitest-environment happy-dom */
// BAD-686: the guard line on an agent row, from its host's status through the shared line function.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import {
  commandGuardCoverage,
  commandGuardSurfaceCoverage
} from '../../../../shared/fork/command-guards'
import type { ForkCommandGuardsStatusResult } from '../../../../shared/fork/command-guards-wire'
import { structuredAgentSessionPaneKey } from '../../../../shared/agent-session/view/structured-agent-session-projection'
import { resetCommandGuardHostStatusForTests } from './command-guard-host-status'
import { ForkCommandGuardMark } from './ForkCommandGuardMark'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const initial = useAppStore.getState()
const WORKTREE = 'repo-1::/w'
let root: Root | undefined

const STATUS: ForkCommandGuardsStatusResult = {
  enabled: true,
  rules: [],
  agents: commandGuardCoverage(),
  surfaces: commandGuardSurfaceCoverage(),
  unguardedWorkspaces: [],
  chats: [{ sessionId: 'sess-1', surface: 'native-chat', guarded: false }]
}

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
  useAppStore.setState(initial, true)
  resetCommandGuardHostStatusForTests()
})

async function mark(
  status: ForkCommandGuardsStatusResult,
  agent: { paneKey: string; agentType: string; tabId: string },
  read: () => ForkCommandGuardsStatusResult = () => status
): Promise<HTMLElement | null> {
  useAppStore.setState({
    unifiedTabsByWorktree: {
      [WORKTREE]: [
        { id: 'tab-chat', contentType: 'agent-session', entityId: 'sess-1' }
      ] as unknown as AppState['unifiedTabsByWorktree'][string]
    }
  })
  resetCommandGuardHostStatusForTests(async () => read())
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <TooltipProvider>
        <ForkCommandGuardMark
          agent={{
            paneKey: agent.paneKey,
            agentType: agent.agentType,
            tab: { id: agent.tabId, worktreeId: WORKTREE }
          }}
          highlighted={false}
        />
      </TooltipProvider>
    )
  })
  return container.querySelector('[data-fork-command-guard]')
}

const CHAT = {
  paneKey: structuredAgentSessionPaneKey('tab-chat', 'sess-1'),
  agentType: 'claude',
  tabId: 'tab-chat'
}

describe('ForkCommandGuardMark', () => {
  it('shows a Codex terminal as unguarded with the reason', async () => {
    const node = await mark(STATUS, { paneKey: 'tab-t:leaf-1', agentType: 'codex', tabId: 'tab-t' })
    expect(node?.getAttribute('data-fork-command-guard')).toBe('unguarded')
    expect(node?.getAttribute('aria-label')).toBe(
      'Command guards: unguarded: its hook cannot block a call or Orca does not read its reply'
    )
  })

  it('shows a Claude chat its host started with no guard as unguarded', async () => {
    const node = await mark(STATUS, CHAT)
    expect(node?.getAttribute('aria-label')).toBe(
      'Command guards: unguarded: this chat started while the guards were not running on its host'
    )
  })

  it('reads the host once more for a chat its answer does not know, which may have just started', async () => {
    vi.useFakeTimers()
    const reads: number[] = []
    const node = await mark({ ...STATUS, chats: [] }, CHAT, () => {
      reads.push(1)
      const chats = reads.length > 1 ? [{ ...STATUS.chats![0], guarded: true }] : []
      return { ...STATUS, chats }
    })
    expect(node?.getAttribute('aria-label')).toContain('this chat is not known to this app')
    await act(() => vi.advanceTimersByTimeAsync(5_000))
    expect(
      document.querySelector('[data-fork-command-guard]')?.getAttribute('data-fork-command-guard')
    ).toBe('guarded')
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(reads).toHaveLength(2)
    vi.useRealTimers()
  })

  it('shows a Claude terminal as guarded', async () => {
    const node = await mark(STATUS, {
      paneKey: 'tab-t:leaf-1',
      agentType: 'claude',
      tabId: 'tab-t'
    })
    expect(node?.getAttribute('data-fork-command-guard')).toBe('guarded')
  })

  it('shows nothing when the host has command guards off', async () => {
    const node = await mark(
      { ...STATUS, enabled: false },
      { paneKey: 'tab-t:leaf-1', agentType: 'codex', tabId: 'tab-t' }
    )
    expect(node).toBeNull()
  })
})
