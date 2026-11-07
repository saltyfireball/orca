import { describe, expect, it } from 'vitest'
import { isNativeChatRunTargetCurrent, type NativeChatRunTarget } from './native-chat-run-target'

const captured: NativeChatRunTarget = {
  target: { kind: 'environment', environmentId: 'env-a' },
  worktreeId: 'wt-1',
  groupId: 'group-1'
}
const liveOwner = {
  target: { kind: 'environment', environmentId: 'env-a' } as const,
  worktreeId: 'wt-1'
}
const resolvedTarget = { kind: 'environment', environmentId: 'env-a' } as const

describe('isNativeChatRunTargetCurrent', () => {
  it('accepts the same workspace on the same host', () => {
    expect(
      isNativeChatRunTargetCurrent({ captured, liveOwner, worktreeExists: true, resolvedTarget })
    ).toBe(true)
  })

  it('refuses when the workspace is gone', () => {
    expect(
      isNativeChatRunTargetCurrent({ captured, liveOwner, worktreeExists: false, resolvedTarget })
    ).toBe(false)
  })

  it('refuses when the chat left the transcript or moved workspace', () => {
    expect(
      isNativeChatRunTargetCurrent({
        captured,
        liveOwner: null,
        worktreeExists: true,
        resolvedTarget
      })
    ).toBe(false)
    expect(
      isNativeChatRunTargetCurrent({
        captured,
        liveOwner: { ...liveOwner, worktreeId: 'wt-2' },
        worktreeExists: true,
        resolvedTarget
      })
    ).toBe(false)
  })

  it('refuses when the chat now talks to another host', () => {
    expect(
      isNativeChatRunTargetCurrent({
        captured,
        liveOwner: { target: { kind: 'environment', environmentId: 'env-b' }, worktreeId: 'wt-1' },
        worktreeExists: true,
        resolvedTarget
      })
    ).toBe(false)
    expect(
      isNativeChatRunTargetCurrent({
        captured,
        liveOwner: { target: { kind: 'local' }, worktreeId: 'wt-1' },
        worktreeExists: true,
        resolvedTarget
      })
    ).toBe(false)
  })

  it('refuses when the workspace owner is ambiguous or resolves to another host', () => {
    expect(
      isNativeChatRunTargetCurrent({
        captured,
        liveOwner,
        worktreeExists: true,
        resolvedTarget: null
      })
    ).toBe(false)
    expect(
      isNativeChatRunTargetCurrent({
        captured,
        liveOwner,
        worktreeExists: true,
        resolvedTarget: { kind: 'local' }
      })
    ).toBe(false)
  })
})
