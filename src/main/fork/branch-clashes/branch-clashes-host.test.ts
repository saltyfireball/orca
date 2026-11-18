import { describe, expect, it, vi } from 'vitest'
import type { RuntimeStore } from '../../runtime/construction/runtime-store-contract'
import { scanForkClashesHere } from './branch-clashes-host'

function store(settings: unknown): RuntimeStore {
  return { getSettings: () => settings, getRepos: vi.fn(() => []) } as unknown as RuntimeStore
}

describe('scanForkClashesHere', () => {
  it('answers off when this host has the warning switched off', async () => {
    await expect(
      scanForkClashesHere(store({ forkBranchClashes: false }), undefined)
    ).resolves.toEqual({ off: true, repos: [] })
  })

  it('shares one scan between callers asking for the same project at once', async () => {
    const host = store({})
    const first = scanForkClashesHere(host, 'orca')
    const second = scanForkClashesHere(host, 'orca')
    expect(second).toBe(first)
    await first
    expect(host.getRepos).toHaveBeenCalledTimes(1)
    await scanForkClashesHere(host, 'orca')
    expect(host.getRepos).toHaveBeenCalledTimes(2)
  })
})
