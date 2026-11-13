// SLRM-2098: a gate with fake settings, processes and clock for the queue's tests.
import type { ForkAgentQueueConfig, ForkAgentQueueKind } from '../../../shared/fork/agent-queue'
import { AgentLaunchGate, type GateHold } from './agent-launch-gate'

export type TestGate = {
  gate: AgentLaunchGate
  config: ForkAgentQueueConfig
  live: Map<string, ForkAgentQueueKind>
  hold: GateHold
  clock: { now: number }
  /** Runs the pending poll, as the timer would. */
  poll: () => void
  pendingPolls: () => number
}

const HOLD_OFF: GateHold = { hold: false }

export function testGate(config: Partial<ForkAgentQueueConfig> = {}): TestGate {
  const state = {
    config: {
      enabled: true,
      maxLive: 2,
      separate: false,
      maxWorkers: 2,
      resumeBypass: true,
      ...config
    },
    live: new Map<string, ForkAgentQueueKind>(),
    hold: HOLD_OFF,
    clock: { now: 1_000 }
  }
  const polls: (() => void)[] = []
  let ids = 0
  const gate = new AgentLaunchGate({
    readConfig: () => state.config,
    readLive: () => state.live,
    shouldHold: () => state.hold,
    now: () => state.clock.now,
    schedule: (run) => {
      polls.push(run)
      return () => {
        const at = polls.indexOf(run)
        if (at !== -1) {
          polls.splice(at, 1)
        }
      }
    },
    newId: () => `t${++ids}`,
    reservationMs: 60_000
  })
  return {
    gate,
    get config() {
      return state.config
    },
    set config(next) {
      state.config = next
    },
    live: state.live,
    get hold() {
      return state.hold
    },
    set hold(next) {
      state.hold = next
    },
    clock: state.clock,
    poll: () => polls.shift()?.(),
    pendingPolls: () => polls.length
  }
}
