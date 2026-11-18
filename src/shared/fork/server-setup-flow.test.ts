import { describe, expect, it, vi } from 'vitest'
import { ForkServerSetupError, isForkMethodMissing, runForkServerSetup } from './server-setup-flow'
import type { ForkServerSetupPlan } from './server-setup-wire'

const PLAN: ForkServerSetupPlan = {
  destination: '/home/me/development',
  folderName: 'repo',
  clonePath: '/home/me/development/repo',
  exists: false
}

const REQUEST = {
  url: 'git@github.com:o/repo.git',
  parent: '~/development',
  serverName: 'build box'
}

function deps(overrides: Partial<Parameters<typeof runForkServerSetup<string>>[0]> = {}) {
  return {
    plan: vi.fn(async () => PLAN),
    clone: vi.fn(async () => 'setup-1'),
    readiness: vi.fn(async () => ({ missing: ['pnpm'], notes: [] })),
    onStage: vi.fn(),
    ...overrides
  }
}

describe('runForkServerSetup', () => {
  it('plans, clones the checked URL, then checks readiness, in that order', async () => {
    const onStage = vi.fn()
    const d = deps({ onStage })
    const outcome = await runForkServerSetup(d, { ...REQUEST, url: ` ${REQUEST.url} ` })
    expect(d.plan).toHaveBeenCalledWith({ url: REQUEST.url, parent: '~/development' })
    expect(d.clone).toHaveBeenCalledWith(PLAN, REQUEST.url)
    expect(d.readiness).toHaveBeenCalledWith(PLAN.clonePath)
    expect(onStage.mock.calls.map((call) => call[0])).toEqual(['planning', 'cloning', 'checking'])
    expect(outcome).toEqual({
      setup: 'setup-1',
      plan: PLAN,
      readiness: { missing: ['pnpm'], notes: [] },
      readinessError: null
    })
  })

  it('refuses a local URL before asking the server anything', async () => {
    const d = deps()
    await expect(runForkServerSetup(d, { ...REQUEST, url: 'file:///srv/repo' })).rejects.toThrow(
      ForkServerSetupError
    )
    expect(d.plan).not.toHaveBeenCalled()
  })

  it('refuses an unusable parent folder', async () => {
    await expect(runForkServerSetup(deps(), { ...REQUEST, parent: '~other' })).rejects.toThrow(
      /not a usable path/
    )
  })

  it('stops when the folder is taken, without cloning', async () => {
    const d = deps({ plan: vi.fn(async () => ({ ...PLAN, exists: true })) })
    await expect(runForkServerSetup(d, REQUEST)).rejects.toThrow(/already exists on build box/)
    expect(d.clone).not.toHaveBeenCalled()
  })

  it('names a server too old to plan', async () => {
    const missing = Object.assign(new Error('Method not found'), { code: 'method_not_found' })
    const d = deps({ plan: vi.fn().mockRejectedValue(missing) })
    await expect(runForkServerSetup(d, REQUEST)).rejects.toThrow(
      /build box runs an Orca that cannot set projects up/
    )
  })

  it('keeps the setup when readiness fails, and skips it when off', async () => {
    const failing = deps({ readiness: vi.fn().mockRejectedValue(new Error('timed out')) })
    const outcome = await runForkServerSetup(failing, REQUEST)
    expect(outcome.setup).toBe('setup-1')
    expect(outcome.readinessError).toBe('timed out')

    const off = deps({ readiness: undefined })
    expect((await runForkServerSetup(off, REQUEST)).readiness).toBeNull()
  })

  it('passes a clone failure through', async () => {
    const d = deps({ clone: vi.fn().mockRejectedValue(new Error('auth failed')) })
    await expect(runForkServerSetup(d, REQUEST)).rejects.toThrow('auth failed')
    expect(d.readiness).not.toHaveBeenCalled()
  })
})

describe('isForkMethodMissing', () => {
  it('reads the code or the message', () => {
    expect(isForkMethodMissing({ code: 'method_not_found' })).toBe(true)
    expect(isForkMethodMissing(new Error('Unknown method: fork.serverSetup.plan'))).toBe(true)
    expect(isForkMethodMissing(new Error('timeout'))).toBe(false)
  })
})
