import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ForkClaudeSessionAccount,
  ForkClaudeWhichResponse
} from '../../../../shared/fork/claude-account-move'
import type { RuntimeClientTarget } from '../../../../shared/remote-runtime/host-catalog/runtime-client-target'

const { callRuntimeRpc } = vi.hoisted(() => ({ callRuntimeRpc: vi.fn() }))
vi.mock('@/runtime/rpc/calls/runtime-rpc-call', () => ({ callRuntimeRpc }))
vi.mock('@/runtime/provider-accounts/observations/runtime-provider-accounts-client', () => ({
  fetchProviderAccountsSnapshot: vi.fn()
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() }
}))

const { getChatHome, loadChatHome, refreshPendingChatHome, resetClaudeChipCacheForTests } =
  await import('./claude-chip-host-cache')
const { moveClaudeChatsToAccount } =
  await import('../claude-account-move/claude-account-move-client')

const ALPHA: RuntimeClientTarget = { kind: 'environment', environmentId: 'env-alpha' }

function session(overrides: Partial<ForkClaudeSessionAccount> = {}): ForkClaudeSessionAccount {
  return {
    sessionId: 's1',
    name: 'Release',
    workspaceId: 'w1',
    host: 'alpha',
    accountId: null,
    accountLabel: 'System default',
    launch: { home: '/home/j/.claude', accountId: null },
    pinned: false,
    pending: false,
    busy: null,
    ...overrides
  }
}

/** A fake alpha host: `which` answers from `current`, `move` pins s1 to acct-b. */
function fakeKif(initial: ForkClaudeSessionAccount) {
  let current = initial
  callRuntimeRpc.mockImplementation(async (_target: unknown, method: string) => {
    if (method === 'fork.claudeAccount.which') {
      const reply: ForkClaudeWhichResponse = { host: 'alpha', sessions: [current] }
      return reply
    }
    if (method === 'fork.claudeAccount.move') {
      current = { ...current, accountId: 'acct-b', pinned: true }
      return {
        host: 'alpha',
        accountId: 'acct-b',
        results: [{ sessionId: 's1', name: 'Release', status: 'moved' }]
      }
    }
    throw new Error(`unexpected ${method}`)
  })
  return {
    set: (next: Partial<ForkClaudeSessionAccount>) => {
      current = { ...current, ...next }
    }
  }
}

function whichCalls(): number {
  return callRuntimeRpc.mock.calls.filter((call) => call[1] === 'fork.claudeAccount.which').length
}

beforeEach(() => {
  callRuntimeRpc.mockReset()
  resetClaudeChipCacheForTests()
})

describe('account chip chat reads through fork.claudeAccount.which', () => {
  it('reads the launch home, the pin and a queued move', async () => {
    fakeKif(session({ accountId: 'acct-b', pinned: true, pending: true }))
    await loadChatHome(ALPHA, 's1')
    expect(callRuntimeRpc).toHaveBeenCalledWith(ALPHA, 'fork.claudeAccount.which', {
      sessionId: 's1'
    })
    expect(getChatHome(ALPHA, 's1')).toEqual({
      home: '/home/j/.claude',
      accountId: null,
      pin: 'acct-b',
      pending: true
    })
  })

  it('names no home for a chat its host does not list, and fails on an older host', async () => {
    callRuntimeRpc.mockResolvedValueOnce({ host: 'alpha', sessions: [] })
    await loadChatHome(ALPHA, 's1')
    expect(getChatHome(ALPHA, 's1')).toEqual({ home: null, accountId: null })
    callRuntimeRpc.mockRejectedValueOnce(new Error('method not found'))
    await loadChatHome(ALPHA, 's2')
    expect(getChatHome(ALPHA, 's2')).toBe('failed')
  })

  it('reads the chat again after a move, so the chip names the new account at once', async () => {
    fakeKif(session())
    await loadChatHome(ALPHA, 's1')
    expect(getChatHome(ALPHA, 's1')).not.toHaveProperty('pin')
    await moveClaudeChatsToAccount(ALPHA, { sessionId: 's1' }, 'acct-b', { accountLabel: 'b' })
    await vi.waitFor(() => expect(getChatHome(ALPHA, 's1')).toHaveProperty('pin', 'acct-b'))
    expect(whichCalls()).toBe(2)
  })

  it('reads once more when a move lands while a read is in flight', async () => {
    const host = fakeKif(session())
    const first = loadChatHome(ALPHA, 's1')
    host.set({ accountId: 'acct-b', pinned: true })
    void loadChatHome(ALPHA, 's1', true)
    await first
    await vi.waitFor(() => expect(whichCalls()).toBe(2))
    await vi.waitFor(() => expect(getChatHome(ALPHA, 's1')).toHaveProperty('pin', 'acct-b'))
  })

  it('re-reads a queued move when the chat status changes, and nothing else', async () => {
    const host = fakeKif(session({ accountId: 'acct-b', pinned: true, pending: true }))
    await loadChatHome(ALPHA, 's1')
    refreshPendingChatHome(ALPHA, 's1', 'working')
    refreshPendingChatHome(ALPHA, 's1', 'working')
    expect(whichCalls()).toBe(1)
    host.set({ pending: false, launch: { home: '/home/j/b', accountId: 'acct-b' } })
    refreshPendingChatHome(ALPHA, 's1', 'done')
    await vi.waitFor(() => expect(getChatHome(ALPHA, 's1')).not.toHaveProperty('pending'))
    refreshPendingChatHome(ALPHA, 's1', 'working')
    expect(whichCalls()).toBe(2)
  })
})
