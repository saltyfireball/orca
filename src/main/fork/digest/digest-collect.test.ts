import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ForkDigest, ForkDigestSection } from '../../../shared/fork/digest'
import type { ForkNotifyMessage } from '../idle-recovery/idle-recovery-notify'
import { collectForkDigest, type ForkDigestCollectDeps } from './digest-collect'
import { readForkDigestLastSentAt, runForkDigestTick } from './digest-schedule'

const EMPTY: ForkDigestSection = { tasks: [], pullRequests: [], waiting: [], cost: null, notes: [] }

describe('collectForkDigest', () => {
  it('asks every paired server and says which ones could not answer', async () => {
    const call = vi.fn(async (id: string) => {
      if (id === 'old') {
        throw Object.assign(new Error('nope'), { code: 'method_not_found' })
      }
      if (id === 'down') {
        throw Object.assign(new Error('timeout'), { code: 'timeout' })
      }
      if (id === 'junk') {
        return 'not a section'
      }
      return {
        ...EMPTY,
        tasks: [{ id: 'r1', title: 'Remote', status: 'completed', at: 5, result: null }]
      }
    })
    const deps: ForkDigestCollectDeps = {
      now: () => 100,
      local: async () => EMPTY,
      listEnvironments: () => [
        { id: 'alpha', name: 'alpha' },
        { id: 'old', name: 'old' },
        { id: 'down', name: 'down' },
        { id: 'junk', name: 'junk' }
      ],
      callEnvironment: call,
      serversDown: () => [{ name: 'down', downSince: 1 }]
    }
    const digest = await collectForkDigest(deps, { since: 0 })
    expect(call).toHaveBeenCalledWith('alpha', 'fork.digest.local', { since: 0 }, 45_000)
    expect(digest.hosts.map((host) => [host.name, host.status])).toEqual([
      ['This machine', 'ok'],
      ['alpha', 'ok'],
      ['old', 'no-digest'],
      ['down', 'unreachable'],
      ['junk', 'unreachable']
    ])
    expect(digest.totals.finished).toBe(1)
    expect(digest.serversDown).toEqual([{ name: 'down', downSince: 1 }])
    expect(digest.until).toBe(100)
  })
})

describe('runForkDigestTick', () => {
  let dir = ''
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  const digest: ForkDigest = {
    since: 0,
    until: 1,
    hosts: [],
    serversDown: [],
    totals: {
      finished: 1,
      failed: 0,
      merged: 0,
      open: 0,
      waiting: 0,
      costUsd: null,
      totalTokens: 0
    }
  }

  it('sends nothing while off, then once a day after the hour', async () => {
    dir = mkdtempSync(join(tmpdir(), 'fork-digest-'))
    const send = vi.fn(async (_message: ForkNotifyMessage) => undefined)
    const collect = vi.fn(async () => digest)
    let settings: Record<string, unknown> = {}
    const deps = { settings: () => settings, collect, send }
    const morning = new Date(2026, 10, 18, 9).getTime()
    expect(await runForkDigestTick(deps, dir, morning)).toBe(false)
    expect(send).not.toHaveBeenCalled()

    settings = {
      forkDigest: true,
      forkInboxNotifyWebhookUrl: 'https://hooks.example/x',
      forkInboxNotifyCommand: 'cat'
    }
    expect(await runForkDigestTick(deps, dir, new Date(2026, 10, 18, 7).getTime())).toBe(true)
    expect(send).not.toHaveBeenCalled()

    expect(await runForkDigestTick(deps, dir, morning)).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
    expect(collect).toHaveBeenCalledWith(morning - 24 * 60 * 60_000)
    const message = send.mock.calls[0][0]
    expect(message.webhookUrl).toBe('https://hooks.example/x')
    expect(message.desktop).toBeNull()
    expect(JSON.parse(message.payload()).event).toBe('digest')
    expect(await readForkDigestLastSentAt(dir)).toBe(morning)
    expect(statSync(join(dir, 'fork-digest.json')).mode & 0o777).toBe(0o600)

    await runForkDigestTick(deps, dir, morning + 60_000)
    expect(send).toHaveBeenCalledTimes(1)

    const tomorrow = new Date(2026, 10, 19, 8, 5).getTime()
    await runForkDigestTick(deps, dir, tomorrow)
    expect(send).toHaveBeenCalledTimes(2)
    expect(collect).toHaveBeenLastCalledWith(morning)
    expect(JSON.parse(readFileSync(join(dir, 'fork-digest.json'), 'utf8')).lastSentAt).toBe(
      tomorrow
    )
  })
})
