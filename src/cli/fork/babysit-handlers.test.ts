// PR babysitter (SLRM-2386): `orca babysit` against a fake client; no app is contacted.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch/dispatch'
import { RuntimeClientError } from '../runtime/connection/types'
import type { PrBabysitEntry } from '../../shared/fork/pr-babysit'
import { FORK_BABYSIT_HANDLERS, formatBabysitList } from './babysit-handlers'

const entry: PrBabysitEntry = {
  prKey: 'github.com/acme/api#12',
  source: 'cli',
  chatId: 'chat-1',
  rounds: 1,
  phase: 'fixing',
  reason: null,
  detail: '',
  lastEvent: null,
  headSha: null,
  fixSentAt: 1,
  stuckSince: null,
  updatedAt: 1
}

let calls: { method: string; params: unknown }[] = []
let printed: string[] = []

async function run(key: string, flags: Record<string, string>, result: unknown): Promise<string> {
  calls = []
  printed = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    printed.push(line)
  })
  const ctx = {
    flags: new Map(Object.entries(flags)),
    json: false,
    cwd: '/tmp',
    client: {
      call: async (method: string, params: unknown) => {
        calls.push({ method, params })
        return { id: '1', ok: true, result, _meta: { runtimeId: 't' } }
      }
    }
  } as unknown as HandlerContext
  await FORK_BABYSIT_HANDLERS[key]!(ctx)
  return printed.join('\n')
}

afterEach(() => vi.restoreAllMocks())

describe('orca babysit', () => {
  it('starts and stops through the host', async () => {
    const out = await run(
      'babysit',
      { pr: 'acme/api#12' },
      { prKey: entry.prKey, result: 'started', entry }
    )
    expect(calls).toEqual([{ method: 'fork.prBabysit.start', params: { pr: 'acme/api#12' } }])
    expect(out).toContain('github.com/acme/api#12: babysat')
    await run(
      'babysit stop',
      { pr: 'acme/api#12' },
      { prKey: entry.prKey, result: 'stopped', entry }
    )
    expect(calls[0]?.method).toBe('fork.prBabysit.stop')
  })

  it('refuses a missing or unreadable pull request', async () => {
    await expect(run('babysit', {}, {})).rejects.toThrow(/Name a pull request/)
    await expect(
      run('babysit', { pr: 'x' }, { prKey: null, result: 'invalid', entry: null })
    ).rejects.toThrow(RuntimeClientError)
  })

  it('lists each pull request with its state', () => {
    const text = formatBabysitList({
      now: 2,
      reposOn: false,
      autoMerge: false,
      maxRounds: 3,
      entries: [entry]
    })
    expect(text).toContain('auto-merge: off')
    expect(text).toContain('github.com/acme/api#12  fix 1 of 3 sent, waiting for CI')
  })
})
