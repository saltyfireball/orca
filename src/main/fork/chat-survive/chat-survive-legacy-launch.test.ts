import { describe, expect, it, vi } from 'vitest'
import type { ProcessSpec } from '@orca/process-host/process-spec'
import {
  spawnProviderProcess,
  type ProviderProcessSpawner
} from '../../provider-process/provider-process-spawn'
import { createProviderSpawnSpec } from '../../provider-process/provider-process-supervisor'
import { isProviderSupervisorSpawn } from './chat-survive-launch'
import {
  forkLegacyProviderLaunch,
  markForkLegacyProviderLaunch
} from './chat-survive-legacy-launch'

// A host where upstream's native launcher is available, as on a desktop install.
vi.mock('../../provider-process/provider-ownership-journal', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  providerOwnershipBootId: () => '01234567-89ab-4cde-8f01-23456789abcd'
}))

const CAPTURED = new Error('captured')

/** The spec `spawnProviderProcess` hands this spawner; nothing is spawned. */
function specFor(mark: boolean): ProcessSpec {
  const seen: ProcessSpec[] = []
  const spawner: ProviderProcessSpawner = (spec) => {
    seen.push(spec)
    throw CAPTURED
  }
  if (mark) {
    markForkLegacyProviderLaunch(spawner)
  }
  expect(forkLegacyProviderLaunch(spawner)).toBe(mark)
  const launch = createProviderSpawnSpec({ command: 'claude', args: ['--print'] }, {}, 'darwin')
  expect(() => spawnProviderProcess(launch, spawner)).toThrow(CAPTURED)
  const [spec] = seen
  if (!spec) {
    throw new Error('no spawn')
  }
  return spec
}

describe('chat-survive legacy launch hook', () => {
  it('leaves an unmarked spawn on the native launcher', () => {
    const spec = specFor(false)
    expect(isProviderSupervisorSpawn(spec)).toBe(false)
    expect(spec.program).toMatch(/orca-provider-exec$/)
  })

  it('gives a marked spawner the Node supervisor a broker can run', () => {
    const spec = specFor(true)
    expect(isProviderSupervisorSpawn(spec)).toBe(true)
    expect(spec.program).toBe(process.execPath)
    // The provider command follows the supervisor's separator unchanged.
    expect(spec.args?.slice(3)).toEqual(['claude', '--print'])
  })

  it('treats a missing spawner as unmarked', () => {
    expect(forkLegacyProviderLaunch(undefined)).toBe(false)
  })
})
