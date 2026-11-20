import { describe, expect, it, vi } from 'vitest'
import type { ForkServerUpdateStatus } from '../../../shared/fork/server-update-wire'
import { listForkServers, runForkServers, type ForkServersDeps } from './servers-fleet'

function status(
  version: string,
  job: ForkServerUpdateStatus['job'] = null
): ForkServerUpdateStatus {
  return {
    version,
    platform: 'linux',
    arch: 'x64',
    install: { kind: 'linux-server', path: '/srv/orca-server', service: 'orca-serve.service' },
    accept: true,
    previousVersion: null,
    job
  }
}

function job(phase: 'downloading' | 'restarting' | 'done' | 'failed', message?: string) {
  return {
    id: 'j1',
    kind: 'update' as const,
    phase,
    fromVersion: '1.4.259010',
    targetVersion: '1.4.261002',
    startedAt: 1,
    updatedAt: 1,
    ...(message ? { message } : {})
  }
}

describe('ssh-managed servers', () => {
  // kif: an orca serve service. m2mac: desktop-deployed orcad over an SSH tunnel, no service.
  function deps(calls: string[] = []): ForkServersDeps {
    const sshStatus: ForkServerUpdateStatus = {
      ...status('1.4.262001'),
      buildVersion: '0.1.0+081afb112818',
      install: null,
      problem: 'no `orca serve` service runs this profile here'
    }
    return {
      listEnvironments: async () => [
        { id: 'kif', name: 'kif' },
        { id: 'm2mac', name: 'm2mac', connectionDependency: 'ssh-tunnel' }
      ],
      call: async (id, method) => {
        calls.push(`${id} ${method}`)
        return id === 'kif' ? status('1.4.262001') : sshStatus
      },
      localVersion: () => '1.4.262001',
      turnWaitMinutes: () => 30,
      now: () => 0,
      sleep: async () => undefined
    }
  }

  it('lists them as ssh-managed rather than an error, and compares release versions', async () => {
    const list = await listForkServers(deps())
    expect(list.servers.map((row) => [row.name, row.versus, row.sshManaged ?? false])).toEqual([
      ['kif', 0, false],
      ['m2mac', 0, true]
    ])
  })

  it('skips them in an update run without asking them to install', async () => {
    const calls: string[] = []
    const rows = await runForkServers(deps(calls), { kind: 'update', version: '1.4.263001' })
    expect(rows.find((row) => row.name === 'm2mac')).toMatchObject({
      outcome: 'skipped',
      message: 'ssh-managed (use orca environment update)'
    })
    expect(calls).not.toContain('m2mac fork.serverUpdate.apply')
  })
})

describe('runForkServers', () => {
  it('updates servers one at a time; one that fails or is down does not stop the rest', async () => {
    const calls: string[] = []
    // kif: updates and is briefly down while it restarts. m2mac: down. wsl: its download fails.
    const replies: Record<string, unknown[]> = {
      kif: [
        status('1.4.259010'),
        { job: job('downloading') },
        'down',
        status('1.4.261002', job('done'))
      ],
      m2mac: ['down'],
      wsl: [
        status('1.4.259010'),
        { job: job('downloading') },
        status('1.4.259010', job('failed', 'checksum mismatch'))
      ]
    }
    let clock = 0
    const deps: ForkServersDeps = {
      listEnvironments: async () => [
        { id: 'kif', name: 'kif' },
        { id: 'm2mac', name: 'm2mac' },
        { id: 'wsl', name: 'wsl-work' }
      ],
      call: async (id, method) => {
        calls.push(`${id} ${method}`)
        const next = replies[id].shift()
        if (next === 'down' || next === undefined) {
          throw Object.assign(new Error('connection refused'), { code: 'runtime_unavailable' })
        }
        return next
      },
      localVersion: () => '1.4.261002',
      turnWaitMinutes: () => 30,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      }
    }
    const rows = await runForkServers(deps, { kind: 'update', version: '1.4.261002', servers: [] })
    expect(rows.map((row) => [row.name, row.outcome, row.version, row.message ?? ''])).toEqual([
      ['kif', 'updated', '1.4.261002', ''],
      ['m2mac', 'failed', undefined, 'it did not answer'],
      ['wsl-work', 'failed', '1.4.259010', 'checksum mismatch']
    ])
    // Strictly in order: each server finishes before the next is asked.
    expect(calls.findIndex((call) => call.startsWith('m2mac'))).toBeGreaterThan(
      calls.lastIndexOf('kif fork.serverUpdate.status')
    )
  })
})

describe('a paired server that never answers (SLRM-2447)', () => {
  // wsl-work: an SSH-managed server whose SSH target sits in "connecting", so the call never settles.
  function deps(asked: string[] = []): ForkServersDeps {
    return {
      listEnvironments: async () => [
        { id: 'kif', name: 'kif' },
        { id: 'wsl', name: 'wsl-work', connectionDependency: 'ssh-tunnel' },
        { id: 'm2mac', name: 'm2mac' }
      ],
      call: async (id) => {
        asked.push(id)
        return id === 'wsl' ? await new Promise<never>(() => {}) : status('1.4.262001')
      },
      localVersion: () => '1.4.262001',
      turnWaitMinutes: () => 30,
      now: () => 0,
      sleep: async () => undefined
    }
  }

  it('costs the list exactly the status limit, asks every server at once, and shows it unreachable', async () => {
    vi.useFakeTimers()
    try {
      const asked: string[] = []
      let settled = false
      const list = listForkServers(deps(asked)).finally(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(asked).toEqual(['kif', 'wsl', 'm2mac'])
      await vi.advanceTimersByTimeAsync(9_999)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect((await list).servers.map((row) => [row.name, row.error ?? null, row.versus])).toEqual([
        ['kif', null, 0],
        ['wsl-work', 'unreachable', null],
        ['m2mac', null, 0]
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails that server in an update run after the limit and goes on to the next', async () => {
    vi.useFakeTimers()
    try {
      const run = runForkServers(deps(), {
        kind: 'update',
        version: '1.4.262001',
        servers: ['wsl-work', 'kif']
      })
      await vi.advanceTimersByTimeAsync(10_000)
      expect((await run).map((row) => [row.name, row.outcome, row.message ?? ''])).toEqual([
        ['wsl-work', 'failed', 'it did not answer'],
        ['kif', 'current', '']
      ])
    } finally {
      vi.useRealTimers()
    }
  })
})
