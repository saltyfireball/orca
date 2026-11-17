import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'
import { HEARTBEAT_IDLE_RECHECK_MS, ServerHeartbeat } from './server-heartbeat'

const SECRET_URL = 'https://hc.example.test/ping/secret-token-123'

function okResponse(ok = true): Response {
  return { ok, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ServerHeartbeat', () => {
  it('calls nothing while no address is set, and picks one up without a restart', async () => {
    vi.useFakeTimers()
    let settings: Partial<ForkGlobalSettings> = {}
    const fetchImpl = vi.fn(async () => okResponse())
    const beat = new ServerHeartbeat({ readSettings: () => settings, fetchImpl })
    beat.start()
    await vi.advanceTimersByTimeAsync(HEARTBEAT_IDLE_RECHECK_MS * 3)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(beat.read().state).toBe('off')

    settings = { forkServerHeartbeatUrl: SECRET_URL, forkServerHeartbeatSeconds: 60 }
    await vi.advanceTimersByTimeAsync(HEARTBEAT_IDLE_RECHECK_MS)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000 * 2)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(SECRET_URL)
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' })
    expect(beat.read().state).toBe('ok')
    beat.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refuses addresses that are not http(s) or carry a user or password', async () => {
    const fetchImpl = vi.fn(async () => okResponse())
    for (const bad of [
      'file:///etc/passwd',
      'ftp://example.test/x',
      'javascript:alert(1)',
      'https://user:pw@example.test/x',
      'https://exa mple.test/x',
      'not a url'
    ]) {
      const beat = new ServerHeartbeat({
        readSettings: () => ({ forkServerHeartbeatUrl: bad }),
        fetchImpl
      })
      await beat.beat()
      beat.stop()
      expect(beat.read().state).toBe('invalid')
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('POSTs an empty body when asked', async () => {
    const fetchImpl = vi.fn(async () => okResponse())
    const beat = new ServerHeartbeat({
      readSettings: () => ({
        forkServerHeartbeatUrl: SECRET_URL,
        forkServerHeartbeatMethod: 'POST'
      }),
      fetchImpl
    })
    await beat.beat()
    beat.stop()
    expect(fetchImpl.mock.calls[0]).toMatchObject([SECRET_URL, { method: 'POST', body: '' }])
  })

  it('logs only a change between working and failing, never the address', async () => {
    const log = vi.fn()
    let ok = false
    const fetchImpl = vi.fn(async () => {
      if (ok) {
        return okResponse()
      }
      throw new Error(`connect failed to ${SECRET_URL}`)
    })
    const beat = new ServerHeartbeat({
      readSettings: () => ({ forkServerHeartbeatUrl: SECRET_URL }),
      fetchImpl,
      log,
      now: () => 1000
    })
    await beat.beat()
    await beat.beat()
    await beat.beat()
    expect(beat.read()).toEqual({ state: 'failing', lastOkAt: null })
    ok = true
    await beat.beat()
    await beat.beat()
    beat.stop()
    expect(beat.read()).toEqual({ state: 'ok', lastOkAt: 1000 })
    expect(log).toHaveBeenCalledTimes(2)
    for (const [message] of log.mock.calls) {
      expect(String(message)).not.toContain('secret-token')
      expect(String(message)).not.toContain('hc.example.test')
    }
  })

  it('counts a non-2xx answer as failing', async () => {
    const beat = new ServerHeartbeat({
      readSettings: () => ({ forkServerHeartbeatUrl: SECRET_URL }),
      fetchImpl: vi.fn(async () => okResponse(false))
    })
    await beat.beat()
    beat.stop()
    expect(beat.read().state).toBe('failing')
  })
})
