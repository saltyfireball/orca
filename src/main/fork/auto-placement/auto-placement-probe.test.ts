import { describe, expect, it, vi } from 'vitest'
import {
  parseDarwinVmStat,
  pickForkPlacementOnHosts,
  type ForkPlacementDeps
} from './auto-placement-probe'
import type { ForkMachineLoad } from '../../../shared/fork/auto-placement'
import type { ForkAutoPlacementSettings } from '../../../shared/fork/auto-placement'

const GIB = 1024 ** 3

function load(cpuCount: number, loadAverage: number, freeGb: number): ForkMachineLoad {
  return { cpuCount, loadAverage, freeMemoryBytes: freeGb * GIB, totalMemoryBytes: 64 * GIB }
}

function codeError(code: string): Error {
  return Object.assign(new Error(code), { code })
}

function deps(
  settings: ForkAutoPlacementSettings,
  remote: Record<string, unknown | Error>,
  local: ForkMachineLoad = load(8, 6, 4)
): ForkPlacementDeps & { callEnvironment: ReturnType<typeof vi.fn> } {
  const callEnvironment = vi.fn(async (environmentId: string) => {
    const answer = remote[environmentId]
    if (answer instanceof Error) {
      throw answer
    }
    return answer
  })
  return {
    settings: () => settings,
    listEnvironments: () => [
      { id: 'env-a', name: 'alpha' },
      { id: 'env-b', name: 'beta' },
      { id: 'env-c', name: 'gamma' }
    ],
    localLoad: async (repo) => ({ load: local, ...(repo ? { repoFound: true } : {}) }),
    callEnvironment
  }
}

describe('pickForkPlacementOnHosts', () => {
  it('probes this machine and every paired server, skipping the ones that fail', async () => {
    const fake = deps(
      {},
      {
        'env-a': { load: load(16, 1, 48) },
        'env-b': codeError('method_not_found'),
        'env-c': codeError('runtime_unavailable')
      }
    )
    const result = await pickForkPlacementOnHosts(fake, {})
    if (result.off === true) {
      throw new Error('unexpected off')
    }
    expect(result.picked).toMatchObject({ hostKey: 'runtime:env-a', name: 'alpha' })
    expect(
      Object.fromEntries(result.ranked.map((candidate) => [candidate.hostKey, candidate.status]))
    ).toEqual({
      'runtime:env-a': 'eligible',
      local: 'eligible',
      'runtime:env-b': 'no-probe',
      'runtime:env-c': 'unreachable'
    })
    expect(fake.callEnvironment).toHaveBeenCalledWith('env-a', 'fork.placement.load', {}, 2_500)
  })

  it('does not probe manual machines and passes the repo to the probe', async () => {
    const fake = deps(
      { forkPlacement: { 'runtime:env-a': 'manual' } },
      { 'env-b': { load: load(4, 0, 8), repoFound: false } }
    )
    const result = await pickForkPlacementOnHosts(fake, {
      hosts: ['local', 'runtime:env-a', 'runtime:env-b', 'ssh:box'],
      repo: 'id:r1'
    })
    if (result.off === true) {
      throw new Error('unexpected off')
    }
    expect(result.picked?.hostKey).toBe('local')
    expect(fake.callEnvironment).toHaveBeenCalledTimes(1)
    expect(fake.callEnvironment).toHaveBeenCalledWith(
      'env-b',
      'fork.placement.load',
      { repo: 'id:r1' },
      2_500
    )
    const statuses = Object.fromEntries(result.ranked.map((c) => [c.hostKey, c.status]))
    expect(statuses).toEqual({
      local: 'eligible',
      'runtime:env-a': 'manual',
      'runtime:env-b': 'no-repo',
      'ssh:box': 'no-probe'
    })
  })

  it('answers off for an unnamed pick unless that setting is on', async () => {
    const off = await pickForkPlacementOnHosts(deps({}, {}), { unnamed: true, hosts: [] })
    expect(off).toEqual({ off: true })
    const on = await pickForkPlacementOnHosts(deps({ forkPlacementAutoWhenUnnamed: true }, {}), {
      unnamed: true,
      hosts: ['local']
    })
    expect(on).toMatchObject({ picked: { hostKey: 'local' } })
  })

  it('treats a malformed answer as unreachable', async () => {
    const result = await pickForkPlacementOnHosts(
      deps({}, { 'env-a': { load: { cpuCount: 2 } } }),
      {
        hosts: ['runtime:env-a']
      }
    )
    expect(result).toMatchObject({ picked: null, ranked: [{ status: 'unreachable' }] })
  })
})

describe('parseDarwinVmStat', () => {
  it('counts free, inactive, speculative and purgeable pages', () => {
    const text = [
      'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
      'Pages free:                               10.',
      'Pages active:                            500.',
      'Pages inactive:                           20.',
      'Pages speculative:                         5.',
      'Pages wired down:                        100.',
      'Pages purgeable:                           1.'
    ].join('\n')
    expect(parseDarwinVmStat(text)).toBe(36 * 16384)
    expect(parseDarwinVmStat('nonsense')).toBeNull()
  })
})
