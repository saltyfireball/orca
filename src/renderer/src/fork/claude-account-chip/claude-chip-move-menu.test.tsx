// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { ForkClaudeAccountResolution } from './claude-account-identity'
import type { ClaudeChipEvidence } from './claude-chip-evidence'

const KIF: RuntimeClientTarget = { kind: 'environment', environmentId: 'env-kif' }
const LOCAL: RuntimeClientTarget = { kind: 'local' }

type Fake = {
  chat: ClaudeChipEvidence | null
  row: ClaudeChipEvidence | null
  worktreeTarget: RuntimeClientTarget | null
  wsl: boolean
  resolution: ForkClaudeAccountResolution
}

const fake = vi.hoisted(() => {
  const state: Fake = {
    chat: null,
    row: null,
    worktreeTarget: null,
    wsl: false,
    resolution: { kind: 'none' }
  }
  return state
})

type NoState = Record<string, never>

vi.mock('@/store', () => ({
  // Every selector input is mocked below, so the store itself is empty.
  useAppStore: (select: (state: NoState) => unknown) => select({})
}))
vi.mock('./claude-chip-evidence', () => ({
  chatEvidence: () => fake.chat,
  agentRowEvidence: () => fake.row
}))
vi.mock('../claude-account-move/fork-claude-move-actions', () => ({
  forkClaudeWorktreeTarget: () => fake.worktreeTarget
}))
vi.mock('@/runtime/hosts/preflight/local-preflight-context', () => ({
  getLocalProjectExecutionRuntimeContext: () =>
    fake.wsl ? { status: 'resolved', runtime: { kind: 'wsl' } } : null
}))
vi.mock('./use-claude-account', () => ({
  useClaudeAccountForTab: () => fake.resolution,
  useClaudeAccountForWorktree: () => fake.resolution,
  useClaudeAccountForAgentRow: () => fake.resolution
}))
vi.mock('./claude-account-usage', () => ({
  useForkClaudeAccountUsage: () => ({ limits: null, isFetching: false, refresh: () => undefined })
}))
vi.mock('@/components/status-bar/InlineProviderUsage', () => ({
  InlineUsageBars: () => null
}))
vi.mock('@/runtime/provider-accounts/observations/runtime-provider-accounts-client', () => ({
  fetchProviderAccountsSnapshot: vi.fn()
}))
vi.mock('@/runtime/rpc/calls/runtime-rpc-call', () => ({ callRuntimeRpc: vi.fn() }))
vi.mock('../claude-account-move/ForkMoveAccountMenu', () => ({
  ForkMoveAccountMenu: (props: {
    trigger: React.ReactElement
    target: RuntimeClientTarget
    scope: object
  }) => (
    <span
      data-testid="move-menu"
      data-target={JSON.stringify(props.target)}
      data-scope={JSON.stringify(props.scope)}
    >
      {props.trigger}
    </span>
  )
}))

const { ForkClaudeAccountAgentRowChip, ForkClaudeAccountTabChip, ForkClaudeAccountWorktreeChip } =
  await import('./ForkClaudeAccountChips')
const { loadChatHome, resetClaudeChipCacheForTests } = await import('./claude-chip-host-cache')

const ACCOUNT: ForkClaudeAccountResolution = {
  kind: 'account',
  account: { ownerKey: 'k', id: 'a', email: null, label: 'A', colour: 'red', hostLabel: null }
}

function chat(transport: RuntimeClientTarget, wslHostDistro: string | null = null) {
  const evidence: ClaudeChipEvidence = {
    transport,
    ownerTarget: transport,
    wslHostDistro,
    hostLabel: null,
    chatSessionId: 's1'
  }
  return evidence
}

const TAB = { id: 't1', worktreeId: 'w1' }

function menuOf(view: ReturnType<typeof render>) {
  const menu = view.queryByTestId('move-menu')
  if (!menu) {
    return null
  }
  expect(menu.querySelector('[data-testid="fork-account-chip"]')).not.toBeNull()
  return {
    target: JSON.parse(menu.dataset.target ?? 'null'),
    scope: JSON.parse(menu.dataset.scope ?? 'null')
  }
}

beforeEach(() => {
  fake.chat = null
  fake.row = null
  fake.worktreeTarget = null
  fake.wsl = false
  fake.resolution = ACCOUNT
  resetClaudeChipCacheForTests()
})
afterEach(cleanup)

describe('account chip move menu', () => {
  it('moves a native chat tab on the host that runs it', () => {
    fake.chat = chat(KIF)
    const view = render(
      <ForkClaudeAccountTabChip tab={TAB} chat={{ sessionId: 's1', agent: 'claude' }} />
    )
    expect(menuOf(view)).toEqual({ target: KIF, scope: { sessionId: 's1' } })
  })

  it('still opens on a mixed or unknown chip', () => {
    fake.chat = chat(LOCAL)
    fake.resolution = { kind: 'unknown', ownerKey: 'local', hostLabel: null }
    const unknown = render(
      <ForkClaudeAccountTabChip tab={TAB} chat={{ sessionId: 's1', agent: 'claude' }} />
    )
    expect(menuOf(unknown)?.scope).toEqual({ sessionId: 's1' })
    cleanup()
    fake.worktreeTarget = LOCAL
    fake.resolution = { kind: 'mixed', accounts: [] }
    const mixed = render(<ForkClaudeAccountWorktreeChip worktreeId="w1" />)
    expect(menuOf(mixed)).toEqual({ target: LOCAL, scope: { worktreeId: 'w1' } })
  })

  it('has no menu on a terminal tab, a WSL distro chat or a host without the move RPC', async () => {
    fake.chat = chat(LOCAL)
    const terminal = render(<ForkClaudeAccountTabChip tab={TAB} />)
    expect(terminal.getByTestId('fork-account-chip')).not.toBeNull()
    expect(menuOf(terminal)).toBeNull()
    cleanup()
    fake.chat = chat(LOCAL, 'Ubuntu')
    const wsl = render(
      <ForkClaudeAccountTabChip tab={TAB} chat={{ sessionId: 's1', agent: 'claude' }} />
    )
    expect(menuOf(wsl)).toBeNull()
    cleanup()
    resetClaudeChipCacheForTests({
      readChatHome: () => Promise.reject(new Error('method not found'))
    })
    await loadChatHome(KIF, 's1')
    fake.chat = chat(KIF)
    const older = render(
      <ForkClaudeAccountTabChip tab={TAB} chat={{ sessionId: 's1', agent: 'claude' }} />
    )
    expect(menuOf(older)).toBeNull()
  })

  it('moves an agent row native chat, but not a terminal pane row', () => {
    fake.row = chat(KIF)
    const agent = { paneKey: 'p1', tab: TAB }
    const native = render(<ForkClaudeAccountAgentRowChip agent={agent} />)
    expect(menuOf(native)).toEqual({ target: KIF, scope: { sessionId: 's1' } })
    cleanup()
    fake.row = { ...chat(LOCAL), chatSessionId: undefined, transcriptPath: '/x/projects/s' }
    const pane = render(<ForkClaudeAccountAgentRowChip agent={agent} />)
    expect(menuOf(pane)).toBeNull()
  })

  it('moves a worktree on its chat host, except over direct SSH or in WSL', () => {
    fake.worktreeTarget = KIF
    const remote = render(<ForkClaudeAccountWorktreeChip worktreeId="w1" />)
    expect(menuOf(remote)).toEqual({ target: KIF, scope: { worktreeId: 'w1' } })
    cleanup()
    fake.worktreeTarget = null
    expect(menuOf(render(<ForkClaudeAccountWorktreeChip worktreeId="w1" />))).toBeNull()
    cleanup()
    fake.worktreeTarget = LOCAL
    fake.wsl = true
    expect(menuOf(render(<ForkClaudeAccountWorktreeChip worktreeId="w1" />))).toBeNull()
  })
})
