import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClientError } from '../runtime/types'
import type { RuntimeClient } from '../runtime/client'
import type { ForkPlacementPickResult } from '../../shared/fork/auto-placement-wire'
import type { ForkPlacementCandidate } from '../../shared/fork/auto-placement'
import { forkResolveAutoPlacement } from './auto-placement-resolve'

vi.mock('../projects/project-selector', () => ({
  findProjectSetups: async (_client: unknown, setups: unknown[]) => setups,
  setupHostId: (setup: { hostId: string }) => setup.hostId
}))

function candidate(hostKey: string): ForkPlacementCandidate {
  return {
    hostKey,
    name: hostKey,
    preference: 'normal',
    load: { cpuCount: 8, loadAverage: 1, freeMemoryBytes: 8, totalMemoryBytes: 16 },
    status: 'eligible',
    spareCores: 7,
    score: 1
  }
}

function fakeClient(answer: ForkPlacementPickResult | Error, setups: unknown[] = []) {
  const call = vi.fn(async (method: string, params?: unknown) => {
    if (method === 'projectHostSetup.list') {
      return { result: { setups } }
    }
    if (answer instanceof Error) {
      throw answer
    }
    void params
    return { result: answer }
  })
  return { client: { call } as unknown as RuntimeClient, call }
}

function picked(hostKey: string): ForkPlacementPickResult {
  const chosen = candidate(hostKey)
  return { picked: chosen, ranked: [chosen] }
}

function flags(entries: Record<string, string | boolean>): Map<string, string | boolean> {
  return new Map(Object.entries(entries))
}

const WORKER_START = ['orchestration', 'worker-start']

describe('forkResolveAutoPlacement', () => {
  beforeEach(() => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    vi.stubEnv('ORCA_ENVIRONMENT', '')
    vi.stubEnv('ORCA_PAIRING_CODE', '')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('turns --on auto into the picked paired server id', async () => {
    const { client, call } = fakeClient(picked('runtime:env-a'))
    const parsed = flags({ on: 'auto', worktree: 'new-child', repo: 'id:r1' })
    await forkResolveAutoPlacement({ commandPath: WORKER_START, flags: parsed }, () => client)
    expect(parsed.get('on')).toBe('env-a')
    expect(call).toHaveBeenCalledWith(
      'fork.placement.pick',
      { repo: 'id:r1' },
      { timeoutMs: 20_000 }
    )
  })

  it('runs locally, pinned against an ambient environment, when this machine is picked', async () => {
    const { client } = fakeClient(picked('local'))
    const parsed = flags({ on: 'auto', worktree: 'new-top-level', repo: 'id:r1' })
    await forkResolveAutoPlacement({ commandPath: WORKER_START, flags: parsed }, () => client)
    expect(parsed.has('on')).toBe(false)
    expect(parsed.get('environment')).toBe('local')
  })

  it('refuses --on auto without a new worktree or a repo, before asking anything', async () => {
    const { client, call } = fakeClient(picked('local'))
    const run = (entries: Record<string, string | boolean>) =>
      forkResolveAutoPlacement({ commandPath: WORKER_START, flags: flags(entries) }, () => client)
    await expect(run({ on: 'auto', terminal: 't1', repo: 'id:r1' })).rejects.toMatchObject({
      code: 'invalid_argument'
    })
    await expect(run({ on: 'auto', worktree: 'new-child' })).rejects.toMatchObject({
      code: 'invalid_argument'
    })
    expect(call).not.toHaveBeenCalled()
  })

  it('refuses when nothing is eligible, and names a stock Orca as incompatible', async () => {
    const parsed = () => flags({ on: 'auto', worktree: 'new-child', repo: 'id:r1' })
    const none = fakeClient({ picked: null, ranked: [] })
    await expect(
      forkResolveAutoPlacement({ commandPath: WORKER_START, flags: parsed() }, () => none.client)
    ).rejects.toMatchObject({ code: 'invalid_argument' })
    const stock = fakeClient(new RuntimeClientError('method_not_found', 'no'))
    await expect(
      forkResolveAutoPlacement({ commandPath: WORKER_START, flags: parsed() }, () => stock.client)
    ).rejects.toMatchObject({ code: 'incompatible_runtime' })
  })

  it('leaves an unnamed start alone when the setting is off or the pick fails', async () => {
    const off = fakeClient({ off: true })
    const parsed = flags({ worktree: 'new-child', repo: 'id:r1' })
    await forkResolveAutoPlacement({ commandPath: WORKER_START, flags: parsed }, () => off.client)
    expect(off.call).toHaveBeenCalledWith(
      'fork.placement.pick',
      { repo: 'id:r1', unnamed: true },
      { timeoutMs: 20_000 }
    )
    expect([...parsed.keys()]).toEqual(['worktree', 'repo'])
    const broken = fakeClient(new Error('down'))
    await forkResolveAutoPlacement(
      { commandPath: WORKER_START, flags: parsed },
      () => broken.client
    )
    expect([...parsed.keys()]).toEqual(['worktree', 'repo'])
  })

  it('never places an unnamed start that names a terminal or a remote', async () => {
    const { client, call } = fakeClient(picked('runtime:env-a'))
    const starts: Record<string, string>[] = [
      { worktree: 'new-child', repo: 'id:r1', terminal: 't1' },
      { worktree: 'new-child', repo: 'id:r1', environment: 'box' },
      { worktree: 'existing', repo: 'id:r1' }
    ]
    for (const entries of starts) {
      await forkResolveAutoPlacement(
        { commandPath: WORKER_START, flags: flags(entries) },
        () => client
      )
    }
    vi.stubEnv('ORCA_ENVIRONMENT', 'box')
    await forkResolveAutoPlacement(
      { commandPath: WORKER_START, flags: flags({ worktree: 'new-child', repo: 'id:r1' }) },
      () => client
    )
    expect(call).not.toHaveBeenCalled()
  })

  it('turns --host auto into the picked host among the ready setups', async () => {
    const setups = [
      { hostId: 'local', setupState: 'ready' },
      { hostId: 'runtime:env-b', setupState: 'ready' },
      { hostId: 'runtime:env-c', setupState: 'pending' }
    ]
    const { client, call } = fakeClient(picked('runtime:env-b'), setups)
    const parsed = flags({ project: 'web', host: 'auto' })
    await forkResolveAutoPlacement(
      { commandPath: ['worktree', 'create'], flags: parsed },
      () => client
    )
    expect(parsed.get('host')).toBe('runtime:env-b')
    expect(call).toHaveBeenCalledWith(
      'fork.placement.pick',
      { hosts: ['local', 'runtime:env-b'] },
      { timeoutMs: 20_000 }
    )
  })

  it('does not place an unnamed worktree create for a project set up on one machine', async () => {
    const { client, call } = fakeClient(picked('local'), [{ hostId: 'local', setupState: 'ready' }])
    const parsed = flags({ project: 'web' })
    await forkResolveAutoPlacement(
      { commandPath: ['worktree', 'create'], flags: parsed },
      () => client
    )
    expect(parsed.has('host')).toBe(false)
    expect(call.mock.calls.filter(([method]) => method === 'fork.placement.pick')).toHaveLength(1)
  })
})
