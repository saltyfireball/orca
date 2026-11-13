import { afterEach, describe, expect, it } from 'vitest'
import {
  buildForkMemoryStatus,
  FORK_MEMORY_SETTING_DEFAULTS,
  resolveForkMemorySettings,
  type ForkSystemMemory
} from '../../../shared/fork/memory-truth'
import {
  assertForkAgentLaunchAllowed,
  installForkMemorySettingsReader,
  isMemoryOverLaunchThreshold,
  onForkMemoryStatus,
  sampleForkSystemMemory,
  setForkSystemMemoryReaderForTests
} from './pressure-state'
import {
  createForkMemoryEpisode,
  forkMemoryNotificationText,
  shouldNotifyForkMemory
} from './episode'

const GB = 1024 ** 3

function system(over: Partial<ForkSystemMemory> = {}): ForkSystemMemory {
  return {
    total: 32 * GB,
    used: 20 * GB,
    compressed: 2 * GB,
    swapUsed: 0,
    swapTotal: 4 * GB,
    pressure: 'normal',
    sampledAt: 1,
    ...over
  }
}

afterEach(() => {
  installForkMemorySettingsReader(() => null)
  setForkSystemMemoryReaderForTests(null)
})

describe('memory settings', () => {
  it('defaults suit a stranger: warn on, pausing off', () => {
    expect(resolveForkMemorySettings(undefined)).toEqual(FORK_MEMORY_SETTING_DEFAULTS)
    expect(FORK_MEMORY_SETTING_DEFAULTS.pauseLaunches).toBe(false)
  })

  it('clamps and rejects bad values', () => {
    expect(
      resolveForkMemorySettings({
        forkMemoryWarnPressure: 'loud' as never,
        forkMemoryWarnSwapGb: -3,
        forkMemoryPollSeconds: 1,
        forkMemoryPauseLaunches: 'yes' as never
      })
    ).toEqual({ warnPressure: 'warn', warnSwapGb: 0, pollSeconds: 5, pauseLaunches: false })
  })
})

describe('threshold', () => {
  const settings = resolveForkMemorySettings(null)
  it('is over at the pressure level or the swap amount', () => {
    expect(buildForkMemoryStatus(system(), settings).over).toBe(false)
    expect(buildForkMemoryStatus(system({ pressure: 'warn' }), settings).reasons).toEqual([
      'pressure'
    ])
    expect(buildForkMemoryStatus(system({ swapUsed: 9 * GB }), settings).reasons).toEqual(['swap'])
  })

  it('ignores what the settings switch off', () => {
    const off = { ...settings, warnPressure: 'off' as const, warnSwapGb: 0 }
    expect(
      buildForkMemoryStatus(system({ pressure: 'critical', swapUsed: 99 * GB }), off).over
    ).toBe(false)
    const critical = { ...settings, warnPressure: 'critical' as const }
    expect(buildForkMemoryStatus(system({ pressure: 'warn' }), critical).over).toBe(false)
  })

  it('pauses launches only with the switch on', () => {
    const sample = system({ pressure: 'critical' })
    expect(buildForkMemoryStatus(sample, settings).launchesPaused).toBe(false)
    expect(buildForkMemoryStatus(sample, { ...settings, pauseLaunches: true }).launchesPaused).toBe(
      true
    )
  })

  it('is never over without a sample', () => {
    expect(buildForkMemoryStatus(null, settings).over).toBe(false)
  })
})

describe('pressure state', () => {
  it('answers isMemoryOverLaunchThreshold from the last sample and gates launches', async () => {
    setForkSystemMemoryReaderForTests(async () => system({ pressure: 'critical', sampledAt: 10 }))
    installForkMemorySettingsReader(() => ({ forkMemoryPauseLaunches: true }))
    expect(isMemoryOverLaunchThreshold()).toBe(false)
    const seen: boolean[] = []
    const off = onForkMemoryStatus((status) => seen.push(status.over))
    await sampleForkSystemMemory(10)
    off()
    expect(seen).toEqual([true])
    expect(isMemoryOverLaunchThreshold()).toBe(true)
    expect(() => assertForkAgentLaunchAllowed()).toThrow(/New agents are paused/)
    installForkMemorySettingsReader(() => ({ forkMemoryPauseLaunches: false }))
    expect(() => assertForkAgentLaunchAllowed()).not.toThrow()
  })

  it('reuses a fresh sample instead of reading again', async () => {
    let reads = 0
    setForkSystemMemoryReaderForTests(async () => {
      reads++
      return system({ sampledAt: 1000 })
    })
    await sampleForkSystemMemory(1000)
    await sampleForkSystemMemory(1500)
    expect(reads).toBe(1)
    await sampleForkSystemMemory(5000)
    expect(reads).toBe(2)
  })
})

describe('notification episode', () => {
  const settings = resolveForkMemorySettings({ forkMemoryWarnSwapGb: 1 })
  it('notifies once per time over, and again only after recovering', () => {
    const episode = createForkMemoryEpisode()
    const over = buildForkMemoryStatus(system({ pressure: 'warn' }), settings)
    const under = buildForkMemoryStatus(system(), settings)
    expect([over, over, under, over].map((s) => shouldNotifyForkMemory(episode, s))).toEqual([
      true,
      false,
      false,
      true
    ])
  })

  it('says why and what to do', () => {
    const status = buildForkMemoryStatus(system({ pressure: 'warn', swapUsed: 2 * GB }), {
      ...settings,
      pauseLaunches: true
    })
    const text = forkMemoryNotificationText(status, (_key, fallback, values) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => values?.[name] ?? '')
    )
    expect(text.title).toBe('Memory is running low')
    expect(text.body).toBe(
      'Memory pressure is warn. 2.0 GB of swap in use. New agents are paused until memory frees up.'
    )
  })
})
