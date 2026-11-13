import { describe, expect, it, vi } from 'vitest'
import { FORK_SYNC_STATUS_URL } from '../../../shared/fork/fork-sync-status'
import { createForkSyncStatusReader, type ForkSyncStatusFetch } from './sync-status-fetch'

const FIXTURE = {
  schema: 1,
  state: 'behind',
  reason: 'The rebase worked, but the checks or the push failed, so main did not move.',
  upstreamVersion: '1.4.260',
  forkBaseVersion: '1.4.258',
  conflicts: [],
  since: '2026-11-13T09:30:00.000Z',
  runUrl: null,
  checkedAt: '2026-11-13T09:30:00.000Z'
}

function respond(body: string, ok = true): ForkSyncStatusFetch {
  return vi.fn(async () => ({ ok, text: async () => body }))
}

describe('createForkSyncStatusReader', () => {
  it('fetches the status URL and parses it', async () => {
    const fetchImpl = respond(JSON.stringify(FIXTURE))
    const status = await createForkSyncStatusReader(fetchImpl)()
    expect(status).toMatchObject({ state: 'behind', upstreamVersion: '1.4.260' })
    expect(fetchImpl).toHaveBeenCalledWith(FORK_SYNC_STATUS_URL, expect.anything())
  })

  it('is null on an HTTP error, bad JSON, a huge body or a network failure', async () => {
    expect(await createForkSyncStatusReader(respond('{}', false))()).toBeNull()
    expect(await createForkSyncStatusReader(respond('not json'))()).toBeNull()
    expect(await createForkSyncStatusReader(respond(' '.repeat(70_000)))()).toBeNull()
    const failing: ForkSyncStatusFetch = async () => {
      throw new Error('offline')
    }
    expect(await createForkSyncStatusReader(failing)()).toBeNull()
  })

  it('shares one read between close checks and reads again after the cache window', async () => {
    let now = 0
    const fetchImpl = respond(JSON.stringify(FIXTURE))
    const read = createForkSyncStatusReader(fetchImpl, () => now)
    await Promise.all([read(), read()])
    await read()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    now = 6 * 60 * 1000
    await read()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
