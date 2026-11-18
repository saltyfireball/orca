import { describe, expect, it, vi } from 'vitest'

vi.mock('@/runtime/rpc/calls/runtime-rpc-call', () => ({ callRuntimeRpc: vi.fn() }))

import { forkBatchRoute } from './fork-batch-start-client'

const target = { project: { id: 'github:o/r', name: 'Orca' }, repoId: 'r1', hostId: 'local' }

describe('forkBatchRoute', () => {
  it('sends auto to this desktop with the project only', () => {
    expect(forkBatchRoute(target, true, 'p', ['claude'])).toEqual({
      runtime: { kind: 'local' },
      request: { project: target.project, prompt: 'p', agents: ['claude'], placement: 'auto' }
    })
  })

  it('asks auto to set a server up only when the setting is on (SLRM-2406)', () => {
    expect(forkBatchRoute(target, true, 'p', ['claude'], true).request).toMatchObject({
      placement: 'auto',
      setupMissing: true
    })
    expect(
      forkBatchRoute({ ...target, hostId: 'runtime:env-1' }, false, 'p', ['claude'], true).request
    ).not.toHaveProperty('setupMissing')
  })

  it('sends a paired server run target to that server, by repo', () => {
    expect(forkBatchRoute({ ...target, hostId: 'runtime:env-1' }, false, 'p', ['codex'])).toEqual({
      runtime: { kind: 'environment', environmentId: 'env-1' },
      request: { repo: 'id:r1', prompt: 'p', agents: ['codex'], placement: 'here' }
    })
  })

  it('keeps an SSH run target on this desktop with its host', () => {
    const route = forkBatchRoute({ ...target, hostId: 'ssh:box' }, false, 'p', ['claude'])
    expect(route.runtime).toEqual({ kind: 'local' })
    expect(route.request).toMatchObject({ repo: 'id:r1', repoHostId: 'ssh:box' })
    expect(forkBatchRoute(target, false, 'p', ['claude']).request).not.toHaveProperty('repoHostId')
  })
})
