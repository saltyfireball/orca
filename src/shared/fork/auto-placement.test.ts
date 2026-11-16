import { describe, expect, it } from 'vitest'
import {
  describeForkPlacementCandidate,
  forkPlacementFor,
  forkProjectReadyHere,
  parseForkMachineLoad,
  pickForkPlacement,
  withForkPlacement,
  type ForkMachineLoad,
  type ForkPlacementProbe
} from './auto-placement'
import type { ExecutionHostId } from '../execution-host'
import type { ProjectHostSetup, ProjectHostSetupState } from '../project-types'

const GIB = 1024 ** 3

function load(
  cpuCount: number,
  loadAverage: number,
  freeGb: number,
  totalGb = 64
): ForkMachineLoad {
  return {
    cpuCount,
    loadAverage,
    freeMemoryBytes: freeGb * GIB,
    totalMemoryBytes: totalGb * GIB
  }
}

function probe(hostKey: string, partial: Partial<ForkPlacementProbe> = {}): ForkPlacementProbe {
  return {
    hostKey,
    name: hostKey,
    preference: 'normal',
    load: load(8, 0, 16),
    status: 'ok',
    ...partial
  }
}

describe('pickForkPlacement', () => {
  it('picks the machine with the most spare CPU and memory', () => {
    const result = pickForkPlacement([
      probe('local', { load: load(8, 7, 4) }),
      probe('runtime:a', { load: load(16, 2, 40) }),
      probe('runtime:b', { load: load(16, 12, 20) })
    ])
    expect(result.picked?.hostKey).toBe('runtime:a')
    expect(result.ranked.map((c) => c.hostKey)).toEqual(['runtime:a', 'runtime:b', 'local'])
    expect(result.picked?.score).toBe(1)
  })

  it('weights by preference: prefer beats a slightly freer normal, less loses to it', () => {
    const preferred = pickForkPlacement([
      probe('runtime:free', { load: load(8, 0, 32) }),
      probe('local', { preference: 'prefer', load: load(8, 2, 24) })
    ])
    expect(preferred.picked?.hostKey).toBe('local')
    const less = pickForkPlacement([
      probe('local', { preference: 'less', load: load(8, 0, 32) }),
      probe('runtime:a', { load: load(8, 3, 20) })
    ])
    expect(less.picked?.hostKey).toBe('runtime:a')
  })

  it('never picks manual, unreachable, no-probe or no-repo machines', () => {
    const result = pickForkPlacement([
      probe('local', { preference: 'manual', load: null }),
      probe('runtime:down', { load: null, status: 'unreachable' }),
      probe('runtime:stock', { load: null, status: 'no-probe' }),
      probe('runtime:norepo', { status: 'no-repo' }),
      probe('runtime:busy', { load: load(4, 4, 1) })
    ])
    expect(result.picked?.hostKey).toBe('runtime:busy')
    expect(result.ranked.map((c) => c.status)).toEqual([
      'eligible',
      'manual',
      'unreachable',
      'no-probe',
      'no-repo'
    ])
  })

  it('picks nothing when no machine is eligible', () => {
    const result = pickForkPlacement([
      probe('local', { preference: 'manual' }),
      probe('runtime:down', { load: null, status: 'unreachable' })
    ])
    expect(result.picked).toBeNull()
    expect(pickForkPlacement([]).picked).toBeNull()
  })

  it('keeps the probe order on a tie, and treats load above the core count as no spare CPU', () => {
    const tie = pickForkPlacement([probe('local'), probe('runtime:a')])
    expect(tie.picked?.hostKey).toBe('local')
    const overloaded = pickForkPlacement([
      probe('local', { load: load(4, 9, 8) }),
      probe('runtime:a', { load: load(4, 1, 8) })
    ])
    expect(overloaded.ranked[1]?.spareCores).toBe(0)
    expect(overloaded.picked?.hostKey).toBe('runtime:a')
  })

  it('treats an ok probe without load as unreachable', () => {
    const result = pickForkPlacement([probe('runtime:a', { load: null })])
    expect(result.picked).toBeNull()
    expect(result.ranked[0]?.status).toBe('unreachable')
  })
})

describe('placement settings', () => {
  it('reads unset and unknown values as normal', () => {
    expect(forkPlacementFor(undefined, 'local')).toBe('normal')
    expect(forkPlacementFor({ forkPlacement: { local: 'bogus' as never } }, 'local')).toBe('normal')
    expect(forkPlacementFor({ forkPlacement: { 'runtime:a': 'manual' } }, 'runtime:a')).toBe(
      'manual'
    )
  })

  it('stores only machines that are not normal', () => {
    const settings = { forkPlacement: { local: 'prefer' as const } }
    expect(withForkPlacement(settings, 'runtime:a', 'less')).toEqual({
      local: 'prefer',
      'runtime:a': 'less'
    })
    expect(withForkPlacement(settings, 'local', 'normal')).toEqual({})
  })
})

describe('parseForkMachineLoad', () => {
  it('accepts sane numbers and rejects anything else', () => {
    expect(parseForkMachineLoad(load(8, 1, 2))).toEqual(load(8, 1, 2))
    expect(parseForkMachineLoad(null)).toBeNull()
    expect(parseForkMachineLoad({ ...load(8, 1, 2), cpuCount: 'x' })).toBeNull()
    expect(parseForkMachineLoad({ ...load(8, 1, 2), loadAverage: -1 })).toBeNull()
    expect(parseForkMachineLoad({ ...load(8, 1, 2), totalMemoryBytes: 0 })).toBeNull()
    expect(parseForkMachineLoad({ ...load(8, 1, 2), freeMemoryBytes: Number.NaN })).toBeNull()
  })
})

describe('describeForkPlacementCandidate', () => {
  it('names the machine, its facts and why it was or was not picked', () => {
    const { ranked } = pickForkPlacement([
      probe('runtime:a', { name: 'box', load: load(8, 2, 16, 32) }),
      probe('runtime:b', { name: 'old', load: null, status: 'no-probe', preference: 'less' })
    ])
    expect(describeForkPlacementCandidate(ranked[0]!)).toBe(
      'box (runtime:a, normal): 6.0 of 8 cores spare, 16.0 of 32.0 GB free, score 1.00'
    )
    expect(describeForkPlacementCandidate(ranked[1]!)).toBe(
      'old (runtime:b, less often): no load probe (stock Orca or an older Blackfish)'
    )
  })
})

describe('forkProjectReadyHere', () => {
  const projects = [
    { id: 'github:o/r', displayName: 'Web' },
    { id: 'github:o/s', displayName: 'Docs' }
  ]
  type Setup = Pick<ProjectHostSetup, 'projectId' | 'hostId' | 'setupState'>
  const ready = (
    projectId: string,
    hostId: ExecutionHostId = 'local',
    setupState: ProjectHostSetupState = 'ready'
  ): Setup => ({ projectId, hostId, setupState })

  it('matches a ready setup on this machine by id or by a unique name', () => {
    expect(forkProjectReadyHere(projects, [ready('github:o/r')], 'github:o/r')).toBe(true)
    expect(forkProjectReadyHere(projects, [ready('github:o/r')], ' web ')).toBe(true)
    expect(forkProjectReadyHere(projects, [ready('github:o/r')], 'docs')).toBe(false)
  })

  it('ignores setups for other hosts and setups that are not ready', () => {
    const setups = [
      ready('github:o/r', 'runtime:env-a'),
      ready('github:o/r', 'local', 'setting-up')
    ]
    expect(forkProjectReadyHere(projects, setups, 'github:o/r')).toBe(false)
  })

  it('never guesses between projects sharing a name', () => {
    const twins = [
      { id: 'a', displayName: 'Same' },
      { id: 'b', displayName: 'Same' }
    ]
    expect(forkProjectReadyHere(twins, [ready('a')], 'same')).toBe(false)
  })
})
