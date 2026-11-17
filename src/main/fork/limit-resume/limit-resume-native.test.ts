import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionStatusSummary } from '../../../shared/agent-session/agent-session-wire'
import {
  clearForkBoundaryCompactionTyped,
  setForkBoundaryCompactionTyped
} from '../boundary-compaction/boundary-compaction-typed'
import {
  cancelLimitResumeNative,
  forkUsageLimitChainLimit,
  forkUsageLimitHeld,
  limitResumeNativeEntries,
  resumeLimitResumeNativeNow,
  setForkLimitResumeSettingsReader,
  type LimitResumeNativeHost
} from './limit-resume-native'
import type { IdleRecoveryChatPort } from '../idle-recovery/idle-recovery-ports'

afterEach(() => {
  setForkLimitResumeSettingsReader(() => null)
  clearForkBoundaryCompactionTyped()
})

function host(state: 'scheduled' | 'cancelled' | 'failed' | 'off'): LimitResumeNativeHost & {
  cancel: ReturnType<typeof vi.fn>
} {
  const cancel = vi.fn(async () => {})
  return {
    cancel,
    deps: { store: { listVisibleSessionIds: () => ['s1', 's2'] } },
    readStatusSummary: (id) =>
      id === 's1'
        ? ({
            agent: 'claude',
            usageLimitContinue: { turnItemId: 't1', resetsAt: 1000, continueAt: 2000, state }
          } as unknown as AgentSessionStatusSummary)
        : undefined,
    usageLimitContinue: { cancel }
  }
}

describe('limit resume native hooks', () => {
  it('caps the chain at the setting, never above stock', () => {
    expect(forkUsageLimitChainLimit()).toBe(5)
    setForkLimitResumeSettingsReader(() => ({ forkLimitResumeMaxTries: 2 }))
    expect(forkUsageLimitChainLimit()).toBe(2)
    setForkLimitResumeSettingsReader(() => ({ forkLimitResumeMaxTries: 20 }))
    expect(forkUsageLimitChainLimit()).toBe(5)
  })

  it('holds a chat whose message box has text, unless told not to', () => {
    expect(forkUsageLimitHeld('s1')).toBe(false)
    setForkBoundaryCompactionTyped(1, ['s1'])
    expect(forkUsageLimitHeld('s1')).toBe(true)
    expect(forkUsageLimitHeld('s2')).toBe(false)
    setForkLimitResumeSettingsReader(() => ({ forkLimitResumeHoldWhileTyping: false }))
    expect(forkUsageLimitHeld('s1')).toBe(false)
  })

  it('lists the chats the stock continue parked, by their row', () => {
    const rows = new Map([['s1', { paneKey: 'p:1', worktreeId: 'w', title: 'Fix it' }]])
    expect(limitResumeNativeEntries(host('scheduled'), rows)).toEqual([
      expect.objectContaining({ id: 'chat:s1', paneKey: 'p:1', resumeAt: 2000, state: 'parked' })
    ])
    expect(limitResumeNativeEntries(host('off'), rows)).toEqual([])
    expect(limitResumeNativeEntries(null, rows)).toEqual([])
  })

  it('cancels through the stock cancel', async () => {
    const live = host('scheduled')
    expect(await cancelLimitResumeNative(live, 's1')).toBe(true)
    expect(live.cancel).toHaveBeenCalledWith({ sessionId: 's1', turnItemId: 't1', resetsAt: 1000 })
    expect(await cancelLimitResumeNative(live, 's2')).toBe(false)
  })

  it('resumes now only an idle chat with no draft', async () => {
    const send = vi.fn(async () => 'queued' as const)
    const port: IdleRecoveryChatPort = {
      read: (id) =>
        id === 'busy'
          ? { fence: 1, loaded: true, inTurn: true }
          : { fence: 2, loaded: true, inTurn: false },
      send
    }
    expect(await resumeLimitResumeNativeNow(port, 'busy')).toBe('refused')
    expect(await resumeLimitResumeNativeNow(port, 's1')).toBe('sent')
    expect(send).toHaveBeenCalledWith('s1', 'Continue where you left off.', 2)
    setForkBoundaryCompactionTyped(1, ['s1'])
    expect(await resumeLimitResumeNativeNow(port, 's1')).toBe('refused')
  })
})
