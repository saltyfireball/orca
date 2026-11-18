import { describe, expect, it, vi } from 'vitest'
import type { ForkPlacementPickResult } from '../../../shared/fork/auto-placement-wire'
import type { ForkPlacementCandidate } from '../../../shared/fork/auto-placement'
import type { ForkBatchStartRequest } from '../../../shared/fork/batch-start'
import { runForkBatchStart, type ForkBatchStartDeps } from './batch-start-run'

function candidate(hostKey: string, name: string): ForkPlacementCandidate {
  return { hostKey, name, preference: 'normal', status: 'eligible', load: null, score: 1 }
}

function deps(overrides: Partial<ForkBatchStartDeps> = {}): ForkBatchStartDeps {
  let n = 0
  return {
    pick: vi.fn(async () => ({ picked: candidate('local', 'this machine'), ranked: [] })),
    readySetupHosts: vi.fn(() => ['local']),
    localRepo: vi.fn(() => 'id:r1'),
    localLabel: () => 'm2mac',
    launch: vi.fn(async () => ({
      worktreeId: `w${++n}`,
      outcome: { kind: 'structured', sessionId: `s${n}` }
    })),
    queuePosition: vi.fn(async () => null),
    forward: vi.fn(),
    randomTail: () => 'ab12',
    ...overrides
  }
}

const here: ForkBatchStartRequest = {
  repo: 'id:r1',
  repoHostId: 'ssh:box',
  prompt: 'Fix login',
  agents: ['claude', 'codex'],
  placement: 'here'
}

describe('runForkBatchStart', () => {
  it('starts one worktree per model on this machine, in order, with the prompt', async () => {
    const d = deps({ queuePosition: vi.fn(async (id: string) => (id === 's2' ? 4 : null)) })
    const result = await runForkBatchStart(d, here)
    expect(result.hostKey).toBe('local')
    expect(result.hostLabel).toBe('m2mac')
    expect(result.tasks).toEqual([
      { agent: 'claude', ok: true, worktreeId: 'w1', name: 'fix-login-claude-ab12' },
      {
        agent: 'codex',
        ok: true,
        worktreeId: 'w2',
        name: 'fix-login-codex-ab12',
        queuedPosition: 4
      }
    ])
    const first = vi.mocked(d.launch).mock.calls[0]?.[0]
    expect(first?.target.create).toMatchObject({ repo: 'id:r1', repoHostId: 'ssh:box' })
    expect(first?.prompt).toEqual({ text: 'Fix login', delivery: 'submit' })
    expect(first?.presentation).toBe('background')
    expect(d.pick).not.toHaveBeenCalled()
  })

  it('keeps going when one model fails, and reports it', async () => {
    const launch = vi
      .fn()
      .mockRejectedValueOnce(new Error('no codex'))
      .mockResolvedValueOnce({ worktreeId: 'w', outcome: { kind: 'terminal' } })
    const result = await runForkBatchStart(deps({ launch }), {
      ...here,
      agents: ['codex', 'claude']
    })
    expect(result.tasks[0]).toEqual({ agent: 'codex', ok: false, error: 'no codex' })
    expect(result.tasks[1]).toMatchObject({ agent: 'claude', ok: true })
  })

  it('refuses a project with no setup here', async () => {
    await expect(
      runForkBatchStart(deps({ localRepo: () => null }), {
        project: { id: 'p' },
        prompt: 'x',
        agents: ['claude'],
        placement: 'here'
      })
    ).rejects.toThrow('no ready setup on m2mac')
  })

  it('auto: runs here when this machine is picked, from the project setup', async () => {
    const d = deps({ readySetupHosts: () => ['local', 'runtime:s1'] })
    const result = await runForkBatchStart(d, {
      project: { id: 'p1', name: 'Orca' },
      prompt: 'x',
      agents: ['claude'],
      placement: 'auto'
    })
    expect(d.pick).toHaveBeenCalledWith(['local', 'runtime:s1'], 'p1')
    expect(result.hostKey).toBe('local')
    expect(vi.mocked(d.launch).mock.calls[0]?.[0].target.create.repo).toBe('id:r1')
  })

  it('auto: forwards to the picked server as here, by project only', async () => {
    const forward = vi.fn(async () => ({
      hostKey: 'local',
      hostLabel: 'kif-host',
      tasks: [{ agent: 'claude' as const, ok: true as const, worktreeId: 'w', name: 'n' }]
    }))
    const d = deps({
      pick: async (): Promise<ForkPlacementPickResult> => ({
        picked: candidate('runtime:s1', 'kif'),
        ranked: []
      }),
      forward
    })
    const result = await runForkBatchStart(d, {
      project: { id: 'p1' },
      repo: 'id:local-only',
      prompt: 'x',
      agents: ['claude'],
      placement: 'auto'
    })
    expect(forward).toHaveBeenCalledWith('s1', {
      project: { id: 'p1' },
      prompt: 'x',
      agents: ['claude'],
      placement: 'here'
    })
    expect(result).toMatchObject({ hostKey: 'runtime:s1', hostLabel: 'kif' })
    expect(d.launch).not.toHaveBeenCalled()
  })

  it('auto: names a server without the method, and says when nothing can take it', async () => {
    const methodMissing = Object.assign(new Error('x'), { code: 'method_not_found' })
    await expect(
      runForkBatchStart(
        deps({
          pick: async () => ({ picked: candidate('runtime:s1', 'kif'), ranked: [] }),
          forward: vi.fn(async () => {
            throw methodMissing
          })
        }),
        { project: { id: 'p1' }, prompt: 'x', agents: ['claude'], placement: 'auto' }
      )
    ).rejects.toThrow('kif runs a Blackfish without batch start')
    await expect(
      runForkBatchStart(deps({ pick: async () => ({ picked: null, ranked: [] }) }), {
        project: { id: 'p1' },
        prompt: 'x',
        agents: ['claude'],
        placement: 'auto'
      })
    ).rejects.toThrow('No machine can take this project now.')
  })
})
