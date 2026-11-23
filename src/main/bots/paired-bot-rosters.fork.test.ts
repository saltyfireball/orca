// Fork test (SLRM-2428): a paired server whose call never settles is marked unreachable. Kept apart
// from upstream's paired-bot-rosters tests, which upstream cut from its suite.
import { expect, it, vi } from 'vitest'
import { readPairedBotRosters } from './paired-bot-rosters'

it('marks a server whose call never settles unreachable after the per-server timeout (SLRM-2428)', async () => {
  vi.useFakeTimers()
  try {
    const runtime = {
      listOrchestrationWorkerServers: async () => [
        { environmentId: 'env-air', name: 'm4 air' },
        { environmentId: 'env-box', name: 'Build Box' },
        { environmentId: 'env-box-2', name: 'Build Box' }
      ],
      // A paired server behind an SSH tunnel still connecting: the transport never settles the call.
      callOrchestrationWorkerServer: vi.fn(async (environmentId: string) =>
        environmentId === 'env-box-2' ? await new Promise<never>(() => {}) : { bots: [] }
      )
    }
    let settled = false
    const read = readPairedBotRosters(runtime).finally(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(3_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await read).toEqual([
      { environmentId: 'env-air', server: { name: 'm4 air', on: 'm4 air' }, bots: [] },
      { environmentId: 'env-box', server: { name: 'Build Box', on: 'env-box' }, bots: [] },
      {
        environmentId: 'env-box-2',
        server: { name: 'Build Box', on: 'env-box-2' },
        unreachable: true
      }
    ])
  } finally {
    vi.useRealTimers()
  }
})
