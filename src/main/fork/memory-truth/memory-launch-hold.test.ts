// SLRM-2136: memory truth's "Pause new agents" through the launch queue, with a fake memory reader,
// fake settings and a fake clock. Queue on: a launch over the threshold waits with the reason and
// starts on recovery or Start now. Queue off: it is refused as before. Never both.
import { afterEach, describe, expect, it } from 'vitest'
import {
  FORK_AGENT_QUEUE_MEMORY_HOLD_REASON,
  forkAgentQueuedLine,
  type ForkAgentQueueKind
} from '../../../shared/fork/agent-queue'
import type { ForkMemoryGlobalSettings, ForkSystemMemory } from '../../../shared/fork/memory-truth'
import { AgentLaunchGate } from '../agent-queue/agent-launch-gate'
import { onLaunchHoldChanged, shouldHoldLaunches } from '../agent-queue/launch-hold'
import { forkMemoryLaunchHold, installForkMemoryLaunchHold } from './memory-launch-hold'
import {
  assertForkAgentLaunchAllowed,
  forkMemoryStatus,
  installForkMemorySettingsReader,
  sampleForkSystemMemory,
  setForkSystemMemoryReaderForTests
} from './pressure-state'

const GB = 1024 ** 3
const clock = { now: 10_000 }
let pressure: ForkSystemMemory['pressure'] = 'normal'
let settings: ForkMemoryGlobalSettings = {}
let uninstall: (() => void) | null = null
let holdChanges = 0
onLaunchHoldChanged(() => {
  holdChanges += 1
})

function fakeMemory(): void {
  setForkSystemMemoryReaderForTests(async () => ({
    total: 32 * GB,
    used: 20 * GB,
    compressed: 2 * GB,
    swapUsed: 0,
    swapTotal: 4 * GB,
    pressure,
    sampledAt: clock.now
  }))
  installForkMemorySettingsReader(() => settings)
}

/** A new sample, as the memory watch's timer takes one (past the 2 s reuse window). */
async function sample(next: ForkSystemMemory['pressure']): Promise<void> {
  pressure = next
  clock.now += 5_000
  await sampleForkSystemMemory(clock.now)
}

function gateOnMemory(): { gate: AgentLaunchGate; poll: () => void } {
  const live = new Map<string, ForkAgentQueueKind>()
  const polls: (() => void)[] = []
  let ids = 0
  const gate = new AgentLaunchGate({
    readConfig: () => ({
      enabled: true,
      maxLive: 4,
      separate: false,
      maxWorkers: 4,
      resumeBypass: true
    }),
    readLive: () => live,
    shouldHold: shouldHoldLaunches,
    now: () => clock.now,
    schedule: (run) => {
      polls.push(run)
      return () => polls.splice(polls.indexOf(run), 1)
    },
    newId: () => `t${++ids}`,
    reservationMs: 60_000
  })
  return { gate, poll: () => polls.shift()?.() }
}

afterEach(() => {
  uninstall?.()
  uninstall = null
  settings = {}
  pressure = 'normal'
  installForkMemorySettingsReader(() => null)
  setForkSystemMemoryReaderForTests(null)
})

describe('memory pause with the launch queue', () => {
  it('queue off: a launch over the threshold is refused and nothing is held', async () => {
    settings = { forkMemoryPauseLaunches: true }
    fakeMemory()
    uninstall = installForkMemoryLaunchHold()
    await sample('warn')
    expect(forkMemoryStatus()).toMatchObject({
      launchesPaused: true,
      launchesHeld: false
    })
    expect(() => assertForkAgentLaunchAllowed()).toThrow(/paused/)
    expect(forkMemoryLaunchHold()).toEqual({ hold: false })
  })

  it('queue on: the launch is held, not refused, and its entry says why', async () => {
    settings = { forkMemoryPauseLaunches: true, forkAgentQueueEnabled: true }
    fakeMemory()
    uninstall = installForkMemoryLaunchHold()
    await sample('warn')
    expect(forkMemoryStatus()).toMatchObject({
      launchesPaused: false,
      launchesHeld: true
    })
    expect(() => assertForkAgentLaunchAllowed()).not.toThrow()
    const { gate } = gateOnMemory()
    const decision = gate.request({
      key: 'a',
      kind: 'interactive',
      label: 'a'
    })
    // Nothing else runs: the hold still queues it, and the entry carries the reason.
    expect(decision.state).toBe('queued')
    expect(decision.state === 'queued' && decision.entry.heldReason).toBe(
      FORK_AGENT_QUEUE_MEMORY_HOLD_REASON
    )
    expect(gate.entries()[0]?.heldReason).toBe(FORK_AGENT_QUEUE_MEMORY_HOLD_REASON)
    expect(forkAgentQueuedLine(gate.entries()[0]!)).toContain('memory is low')
  })

  it('starts the held launch when a sample shows memory recovered', async () => {
    settings = { forkMemoryPauseLaunches: true, forkAgentQueueEnabled: true }
    fakeMemory()
    uninstall = installForkMemoryLaunchHold()
    await sample('warn')
    const { gate } = gateOnMemory()
    const changes = holdChanges
    const decision = gate.request({
      key: 'a',
      kind: 'interactive',
      label: 'a'
    })
    await sample('normal')
    expect(holdChanges).toBe(changes + 1)
    if (decision.state !== 'queued') {
      throw new Error('expected a queued launch')
    }
    // The real service subscribes gate.notify; this test wires it here.
    gate.notify()
    expect(await decision.settled).toBe('admitted')
    expect(gate.entries()).toEqual([])
  })

  it('a later poll also releases it when settings change (pause turned off)', async () => {
    settings = { forkMemoryPauseLaunches: true, forkAgentQueueEnabled: true }
    fakeMemory()
    uninstall = installForkMemoryLaunchHold()
    await sample('warn')
    const { gate, poll } = gateOnMemory()
    const decision = gate.request({
      key: 'a',
      kind: 'interactive',
      label: 'a'
    })
    settings = { forkMemoryPauseLaunches: false, forkAgentQueueEnabled: true }
    poll()
    expect(decision.state === 'queued' && (await decision.settled)).toBe('admitted')
  })

  it('Start now admits a held launch while memory is still low', async () => {
    settings = { forkMemoryPauseLaunches: true, forkAgentQueueEnabled: true }
    fakeMemory()
    uninstall = installForkMemoryLaunchHold()
    await sample('critical')
    const { gate, poll } = gateOnMemory()
    const decision = gate.request({
      key: 'a',
      kind: 'interactive',
      label: 'a'
    })
    const id = gate.entries()[0]!.id
    expect(gate.startNow(id)).toBeTruthy()
    expect(decision.state === 'queued' && (await decision.settled)).toBe('admitted')
    // Still held for others; the started one is not queued again.
    poll()
    expect(gate.entries()).toEqual([])
    expect(forkMemoryStatus().launchesHeld).toBe(true)
  })

  it('never both refuses and holds: the two flags are exclusive in every combination', async () => {
    for (const pause of [false, true]) {
      for (const queue of [false, true]) {
        for (const level of ['normal', 'warn'] as const) {
          settings = {
            forkMemoryPauseLaunches: pause,
            forkAgentQueueEnabled: queue
          }
          fakeMemory()
          await sample(level)
          const status = forkMemoryStatus()
          expect(status.launchesPaused && status.launchesHeld).toBe(false)
          const over = level === 'warn' && pause
          expect(status.launchesPaused || status.launchesHeld).toBe(over)
          expect(status.launchesHeld).toBe(over && queue)
        }
      }
    }
  })

  it('the entry stops naming memory once the hold lifts', async () => {
    settings = { forkMemoryPauseLaunches: true, forkAgentQueueEnabled: true }
    fakeMemory()
    uninstall = installForkMemoryLaunchHold()
    await sample('warn')
    const live = new Map<string, ForkAgentQueueKind>([
      ['x', 'interactive'],
      ['y', 'interactive'],
      ['z', 'interactive'],
      ['w', 'interactive']
    ])
    const gate = new AgentLaunchGate({
      readConfig: () => ({
        enabled: true,
        maxLive: 4,
        separate: false,
        maxWorkers: 4,
        resumeBypass: true
      }),
      readLive: () => live,
      shouldHold: shouldHoldLaunches,
      now: () => clock.now,
      schedule: () => () => undefined,
      newId: () => 't1'
    })
    gate.request({ key: 'a', kind: 'interactive', label: 'a' })
    expect(gate.entries()[0]?.heldReason).toBe(FORK_AGENT_QUEUE_MEMORY_HOLD_REASON)
    await sample('normal')
    gate.notify()
    // Still waiting, now on the agent limit, and no longer blaming memory.
    expect(gate.entries()).toHaveLength(1)
    expect(gate.entries()[0]?.heldReason).toBeUndefined()
  })
})
