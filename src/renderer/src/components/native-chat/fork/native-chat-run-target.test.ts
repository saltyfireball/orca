import { describe, expect, it } from 'vitest'
import {
  isNativeChatRunTargetCurrent,
  nativeChatRunLaunchHostId,
  type NativeChatRunPlace,
  type NativeChatRunTarget
} from './native-chat-run-target'

const env = { kind: 'environment', environmentId: 'env-a' } as const
const captured: NativeChatRunTarget = {
  target: env,
  worktreeId: 'wt-1',
  hostId: 'ssh:one',
  route: { target: env, at: 'ssh:one' },
  groupId: 'group-1'
}
const liveOwner = { target: env, worktreeId: 'wt-1' }
const place: NativeChatRunPlace = { hostId: 'ssh:one', route: { target: env, at: 'ssh:one' } }

function current(overrides: Partial<Parameters<typeof isNativeChatRunTargetCurrent>[0]> = {}) {
  return isNativeChatRunTargetCurrent({
    captured,
    liveOwner,
    onHost: place,
    selected: place,
    ...overrides
  })
}

describe('isNativeChatRunTargetCurrent', () => {
  it('accepts the same workspace on the same route', () => {
    expect(current()).toBe(true)
  })

  it('refuses when the workspace is gone or its owner is ambiguous', () => {
    expect(current({ onHost: null })).toBe(false)
    expect(current({ selected: null })).toBe(false)
    expect(current({ selected: { ...place, route: null } })).toBe(false)
  })

  it('refuses when the chat left the transcript, moved workspace or talks to another host', () => {
    expect(current({ liveOwner: null })).toBe(false)
    expect(current({ liveOwner: { ...liveOwner, worktreeId: 'wt-2' } })).toBe(false)
    expect(current({ liveOwner: { target: { kind: 'local' }, worktreeId: 'wt-1' } })).toBe(false)
  })

  it('tells nested SSH places behind one paired runtime apart', () => {
    const other: NativeChatRunPlace = { hostId: 'ssh:two', route: { target: env, at: 'ssh:two' } }
    expect(current({ selected: other })).toBe(false)
    expect(current({ selected: { ...place, route: { target: env, at: 'ssh:two' } } })).toBe(false)
  })

  it('refuses a local twin swapped for a direct-SSH twin', () => {
    const local = { kind: 'local' } as const
    const onLocal: NativeChatRunTarget = {
      ...captured,
      target: local,
      hostId: 'local',
      route: { target: local, at: 'local' }
    }
    const sshTwin: NativeChatRunPlace = {
      hostId: 'ssh:box',
      route: { target: local, at: 'ssh:box' }
    }
    const localTwin: NativeChatRunPlace = { hostId: 'local', route: { target: local, at: 'local' } }
    const check = (selected: NativeChatRunPlace) =>
      isNativeChatRunTargetCurrent({
        captured: onLocal,
        liveOwner: { target: local, worktreeId: 'wt-1' },
        onHost: localTwin,
        selected
      })
    expect(check(localTwin)).toBe(true)
    expect(check(sshTwin)).toBe(false)
  })
})

describe('nativeChatRunLaunchHostId', () => {
  it('launches on the captured row host', () => {
    expect(nativeChatRunLaunchHostId(captured)).toBe('ssh:one')
  })

  it('launches on the host its route names when the row has none', () => {
    expect(nativeChatRunLaunchHostId({ ...captured, hostId: null })).toBe('ssh:one')
    expect(
      nativeChatRunLaunchHostId({ ...captured, hostId: null, route: { target: env, at: 'local' } })
    ).toBe('runtime:env-a')
    expect(
      nativeChatRunLaunchHostId({
        ...captured,
        target: { kind: 'local' },
        hostId: null,
        route: { target: { kind: 'local' }, at: 'local' }
      })
    ).toBe('local')
  })
})
