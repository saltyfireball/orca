import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'
import { noteForkQueuedAgentLaunch, readForkQueuedLaunch } from './agent-queue-launch-note'
import { formatQueue } from './agent-queue-handlers'

const entry = {
  id: 'abc123',
  sessionId: 's1',
  label: 'fix the tests',
  kind: 'interactive' as const,
  position: 3,
  queuedAt: 0
}

function client(call: (method: string, params: unknown) => Promise<unknown>): RuntimeClient {
  const fake = {
    call: async (method: string, params: unknown) => ({ result: await call(method, params) })
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the note only calls `call`, which this fake implements.
  return fake as unknown as RuntimeClient
}

afterEach(() => vi.restoreAllMocks())

describe('agent queue launch note', () => {
  it('prints the queued line for a chat launch that waits', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const calls: unknown[] = []
    await noteForkQueuedAgentLaunch(
      client(async (method, params) => {
        calls.push([method, params])
        return { state: 'queued', entry }
      }),
      { kind: 'structured', sessionId: 's1' },
      false
    )
    expect(calls).toEqual([['fork.agentQueue.status', { sessionId: 's1', waitMs: 1_500 }]])
    expect(log).toHaveBeenCalledWith(
      'queued, position 3 (start now: orca agent queue start abc123)'
    )
  })

  it('stays quiet for terminals, launches that started, and hosts without a queue', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const asked = vi.fn(async () => ({ state: 'not-queued' }))
    await noteForkQueuedAgentLaunch(client(asked), { kind: 'terminal' }, false)
    expect(asked).not.toHaveBeenCalled()
    await noteForkQueuedAgentLaunch(client(asked), { kind: 'structured', sessionId: 's1' }, false)
    const missing = client(async () => {
      throw new Error('method_not_found')
    })
    expect(await readForkQueuedLaunch(missing, { dispatchId: 'd1' })).toBeNull()
    expect(log).not.toHaveBeenCalled()
  })

  it('lists the queue with counts', () => {
    expect(
      formatQueue({
        enabled: true,
        live: { interactive: 5, worker: 3 },
        limits: { separate: false, maxLive: 8, maxWorkers: 8 },
        entries: [entry]
      })
    ).toBe(
      [
        '8/8 agents running',
        '  #  ID        KIND    CHAT',
        '  3  abc123  chat    fix the tests'
      ].join('\n')
    )
  })
})
