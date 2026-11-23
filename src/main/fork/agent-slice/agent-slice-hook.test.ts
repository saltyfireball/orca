// BAD-684: the terminal host calls the slice limits once, right after the scopes resolve.
import { describe, expect, it, vi } from 'vitest'

const slice = vi.hoisted(() => ({ apply: vi.fn() }))
vi.mock('./agent-slice-install', () => ({ forkApplyAgentSlice: slice.apply }))
vi.mock('../../daemon/process-scopes/terminal-scopes', () => ({
  resolveTerminalScopes: () => ({
    ceiling: { state: 'off', reason: 'disabled' },
    scopes: { off: 'no_user_manager' }
  })
}))
vi.mock('../../windows/windows-pty-job', () => ({ setPtyActiveProcessLimit: () => false }))

import { initializeTerminalScopes } from '../../daemon/process-scopes/terminal-scopes-runtime'

describe('initializeTerminalScopes', () => {
  it('hands the resolved scopes and the daemon log to the agent slice', () => {
    const log = vi.fn()
    initializeTerminalScopes(null, log)
    expect(slice.apply).toHaveBeenCalledTimes(1)
    expect(slice.apply.mock.calls[0][0]).toMatchObject({ scopes: { off: 'no_user_manager' } })
    expect(slice.apply.mock.calls[0][1]).toBe(log)
  })
})
