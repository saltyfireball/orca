import { afterEach, describe, expect, it } from 'vitest'
import {
  buildForkMemoryStatus,
  resolveForkMemorySettings
} from '../../../../shared/fork/memory-truth'
import { forkMemoryLaunchRefusal, setForkMemoryStatusForTests } from './memory-status'

const critical = {
  total: 8,
  used: 8,
  compressed: null,
  swapUsed: null,
  swapTotal: null,
  pressure: 'critical' as const,
  sampledAt: 1
}

afterEach(() => setForkMemoryStatusForTests(null))

describe('forkMemoryLaunchRefusal', () => {
  it('allows launches until main says they are paused', () => {
    expect(forkMemoryLaunchRefusal()).toBeNull()
    setForkMemoryStatusForTests(buildForkMemoryStatus(critical, resolveForkMemorySettings(null)))
    expect(forkMemoryLaunchRefusal()).toBeNull()
  })

  it('refuses with a message that says how to undo it', () => {
    setForkMemoryStatusForTests(
      buildForkMemoryStatus(critical, resolveForkMemorySettings({ forkMemoryPauseLaunches: true }))
    )
    expect(forkMemoryLaunchRefusal()).toMatch(/New agents are paused.*Pause new agents/)
  })
})
