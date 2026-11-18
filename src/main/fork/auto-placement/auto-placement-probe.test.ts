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

describe('pickForkPlacementOnHosts with a project', () => {
  const project = 'github:o/r'

  it('asks each paired server about its own setup and picks one that has it', async () => {
    const fake = deps(
      { forkPlacement: { 'runtime:env-c': 'manual' } },
      {
        'env-a': { load: load(16, 1, 48), projectReady: true },
        'env-b': { load: load(32, 0, 60), projectReady: false }
      }
    )
    const result = await pickForkPlacementOnHosts(fake, { hosts: ['local'], project })
    if (result.off === true) {
      throw new Error('unexpected off')
    }
    expect(result.picked).toMatchObject({ hostKey: 'runtime:env-a', name: 'alpha' })
    expect(Object.fromEntries(result.ranked.map((c) => [c.hostKey, c.status]))).toEqual({
      'runtime:env-a': 'eligible',
      local: 'eligible',
      'runtime:env-b': 'no-setup',
      'runtime:env-c': 'manual'
    })
    expect(fake.callEnvironment).toHaveBeenCalledWith(
      'env-a',
      'fork.placement.load',
      { project },
      2_500
    )
    // A manual machine is never asked.
    expect(fake.callEnvironment).not.toHaveBeenCalledWith(
      'env-c',
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
  })

  it('skips a server that times out or is too old to answer about the project', async () => {
    const fake = deps(
      {},
      {
        'env-a': codeError('timeout'),
        'env-b': { load: load(32, 0, 60) },
        'env-c': codeError('method_not_found')
      }
    )
    const result = await pickForkPlacementOnHosts(fake, { hosts: [], project })
    if (result.off === true) {
      throw new Error('unexpected off')
    }
    expect(result.picked).toBeNull()
    expect(Object.fromEntries(result.ranked.map((c) => [c.hostKey, c.status]))).toEqual({
      local: 'no-setup',
      'runtime:env-a': 'unreachable',
      'runtime:env-b': 'no-setup',
      'runtime:env-c': 'no-probe'
    })
  })

  it('trusts the caller for hosts it listed and asks this machine about the rest', async () => {
    const fake = deps({}, { 'env-a': { load: load(2, 2, 1) } })
    fake.listEnvironments = () => [{ id: 'env-a', name: 'alpha' }]
    const localLoad = vi.fn(async () => ({ load: load(8, 0, 32), projectReady: true }))
    fake.localLoad = localLoad
    const result = await pickForkPlacementOnHosts(fake, { hosts: ['runtime:env-a'], project })
    if (result.off === true) {
      throw new Error('unexpected off')
    }
    expect(localLoad).toHaveBeenCalledWith(undefined, project)
    expect(fake.callEnvironment).toHaveBeenCalledWith('env-a', 'fork.placement.load', {}, 2_500)
    expect(result.picked?.hostKey).toBe('local')
    expect(result.ranked.map((c) => c.status)).toEqual(['eligible', 'eligible'])
  })

  it('counts a server that can clone the project with setupMissing, marked needsSetup (SLRM-2312)', async () => {
    const fake = deps(
      {},
      {
        'env-a': { load: load(32, 0, 60), projectReady: false, canSetUp: true },
        'env-b': { load: load(32, 0, 60), projectReady: false },
        'env-c': { load: load(4, 0, 2), projectReady: true }
      }
    )
    const localLoad = vi.fn(async () => ({ load: load(8, 0, 32), canSetUp: true }))
    fake.localLoad = localLoad
    const result = await pickForkPlacementOnHosts(fake, { hosts: [], project, setupMissing: true })
    if (result.off === true) {
      throw new Error('unexpected off')
    }
    expect(fake.callEnvironment).toHaveBeenCalledWith(
      'env-a',
      'fork.placement.load',
      { project, setupMissing: true },
      2_500
    )
    expect(result.picked).toMatchObject({ hostKey: 'runtime:env-a', needsSetup: true })
    expect(
      Object.fromEntries(result.ranked.map((c) => [c.hostKey, [c.status, c.needsSetup ?? false]]))
    ).toEqual({
      'runtime:env-a': ['eligible', true],
      'runtime:env-c': ['eligible', false],
      // This machine is never cloned onto by a pick, and an older server cannot say it can clone.
      local: ['no-setup', false],
      'runtime:env-b': ['no-setup', false]
    })
  })

  it('never asks whether a server can clone without setupMissing', async () => {
    const fake = deps({}, { 'env-a': { load: load(32, 0, 60), canSetUp: true } })
    fake.listEnvironments = () => [{ id: 'env-a', name: 'alpha' }]
    const result = await pickForkPlacementOnHosts(fake, { hosts: [], project })
    if (result.off === true) {
      throw new Error('unexpected off')
    }
    expect(fake.callEnvironment).toHaveBeenCalledWith(
      'env-a',
      'fork.placement.load',
      { project },
      2_500
    )
    expect(result.picked).toBeNull()
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
