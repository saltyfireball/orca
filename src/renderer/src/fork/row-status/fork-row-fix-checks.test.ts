import { describe, expect, it, vi } from 'vitest'

const targets = vi.hoisted(() => ({ list: [] as unknown[] }))
vi.mock('@/lib/agent-session/messaging/running-agent-targets', () => ({
  deriveRunningAgentSendTargets: () => targets.list,
  runningAgentMessageTarget: (target: { sessionId: string }) => ({
    kind: 'structured-session',
    sessionId: target.sessionId
  })
}))

const { forkFixSendNotice, forkFixTarget } = await import('./fork-row-fix-checks')

const ROW = { paneKey: 'pane-1', tab: { worktreeId: 'w' } }

describe('forkFixTarget', () => {
  it('takes only the row own agent, and only when it can take a message', () => {
    targets.list = [{ paneKey: 'other', status: 'eligible' }]
    expect(forkFixTarget({} as never, ROW)).toHaveProperty('refused')
    targets.list = [{ paneKey: 'pane-1', status: 'disabled', disabledReason: 'Busy starting' }]
    expect(forkFixTarget({} as never, ROW)).toEqual({ refused: 'Busy starting' })
    const target = { paneKey: 'pane-1', status: 'eligible', sessionId: 's' }
    targets.list = [target]
    expect(forkFixTarget({} as never, ROW)).toBe(target)
  })
})

describe('forkFixSendNotice', () => {
  it('counts sent and unconfirmed as asked, the rest as failed', () => {
    expect(forkFixSendNotice({ status: 'sent' }).ok).toBe(true)
    expect(forkFixSendNotice({ status: 'unconfirmed' }).ok).toBe(true)
    expect(forkFixSendNotice({ status: 'not-ready' }).ok).toBe(false)
    expect(forkFixSendNotice({ status: 'not-writable' }).ok).toBe(false)
  })
})
