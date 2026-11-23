// BAD-684: the one `agent-slice` log line, and the daemon hook that calls it.
import { describe, expect, it, vi } from 'vitest'
import type { TerminalScopeResolution } from '../../daemon/process-scopes/terminal-scopes'
import { AGENT_SLICE_NOT_COVERED, forkApplyAgentSlice } from './agent-slice-install'

const off: TerminalScopeResolution = {
  ceiling: { state: 'off', reason: 'disabled' },
  scopes: { off: 'no_user_manager' }
}

describe('forkApplyAgentSlice', () => {
  it('says once, with the reason, that the slice is off, and what it never holds', () => {
    const log = vi.fn()
    forkApplyAgentSlice(off, log, { ORCA_AGENT_SLICE: '1' }, 'linux')
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('agent-slice', {
      applied: [],
      reason: 'terminal scopes off: no_user_manager',
      notCovered: AGENT_SLICE_NOT_COVERED
    })
  })

  it('logs nothing and touches nothing when the switch is off or the host is not Linux', () => {
    const log = vi.fn()
    forkApplyAgentSlice(off, log, {}, 'linux')
    forkApplyAgentSlice(off, log, { ORCA_AGENT_SLICE: '1' }, 'darwin')
    forkApplyAgentSlice(off, log, { ORCA_AGENT_SLICE: '1' }, 'win32')
    expect(log).not.toHaveBeenCalled()
  })
})
