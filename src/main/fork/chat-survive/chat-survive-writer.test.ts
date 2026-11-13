import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import type { DescendantSnapshot } from '../../pty/process-retirement/pty-descendant-termination'
import { killProviderWriter } from '../../provider-process/provider-process-teardown'
import { forkProviderWriterParents } from './chat-survive-writer'

const BROKER = 100
const SUPERVISOR = 200
const WRITER = 300
const HELPER = 400

function root(pid: number) {
  return { pid, kill: vi.fn<ChildProcess['kill']>(() => true) }
}

function snapshot(rows: DescendantSnapshot['descendants'], rootPgid = BROKER): DescendantSnapshot {
  return { rootPgid, descendants: rows, capturedAtMs: 1 }
}

// app -> broker -> supervisor (broker's group) -> writer (own group) -> helper (writer's group)
const underBroker = snapshot([
  { pid: SUPERVISOR, ppid: BROKER, pgid: BROKER, startedAt: 'a' },
  { pid: WRITER, ppid: SUPERVISOR, pgid: WRITER, startedAt: 'b' },
  { pid: HELPER, ppid: WRITER, pgid: WRITER, startedAt: 'c' }
])

describe('killProviderWriter under a chat-survive broker', () => {
  it('reaches the writer group under the supervisor that shares the broker group', () => {
    const signalProcessGroup = vi.fn()
    const broker = root(BROKER)
    const delivered = killProviderWriter(broker, underBroker, {
      supervised: true,
      signalProcessGroup
    })
    expect(delivered).toBe(true)
    expect(signalProcessGroup.mock.calls).toEqual([[WRITER, 'SIGKILL']])
    expect(broker.kill).not.toHaveBeenCalled()
  })

  it('still finds the writer directly under a supervisor root, and only it', () => {
    const signalProcessGroup = vi.fn()
    const supervisor = root(SUPERVISOR)
    const direct = snapshot(
      [
        { pid: WRITER, ppid: SUPERVISOR, pgid: WRITER, startedAt: 'b' },
        { pid: HELPER, ppid: WRITER, pgid: WRITER, startedAt: 'c' }
      ],
      SUPERVISOR
    )
    expect(killProviderWriter(supervisor, direct, { supervised: true, signalProcessGroup })).toBe(
      true
    )
    expect(signalProcessGroup.mock.calls).toEqual([[WRITER, 'SIGKILL']])
  })

  it('does not treat a grandchild under a child in another group as a writer', () => {
    const signalProcessGroup = vi.fn()
    // The root's child leads its own group, so it is the writer; its children are not.
    const rows = snapshot([
      { pid: WRITER, ppid: BROKER, pgid: WRITER, startedAt: 'b' },
      { pid: HELPER, ppid: WRITER, pgid: HELPER, startedAt: 'c' }
    ])
    killProviderWriter(root(BROKER), rows, { supervised: true, signalProcessGroup })
    expect(signalProcessGroup.mock.calls).toEqual([[WRITER, 'SIGKILL']])
  })
})

describe('forkProviderWriterParents', () => {
  it('adds a direct child that shares the root group', () => {
    expect([...forkProviderWriterParents(BROKER, underBroker)]).toEqual([BROKER, SUPERVISOR])
  })

  it('is only the root without a snapshot or a known root group', () => {
    expect([...forkProviderWriterParents(BROKER, null)]).toEqual([BROKER])
    const unknownGroup = { ...underBroker, rootPgid: null }
    expect([...forkProviderWriterParents(BROKER, unknownGroup)]).toEqual([BROKER])
    expect([...forkProviderWriterParents(undefined, underBroker)]).toEqual([])
  })
})
