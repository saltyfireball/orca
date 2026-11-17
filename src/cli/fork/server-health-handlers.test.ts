import { describe, expect, it } from 'vitest'
import { formatServerHealth } from './server-health-handlers'

describe('formatServerHealth', () => {
  it('lists each server with its state and last seen time, then the heartbeat', () => {
    const now = Date.UTC(2026, 10, 17, 14, 0)
    const text = formatServerHealth(
      {
        enabled: true,
        offlineMinutes: 5,
        servers: [
          {
            environmentId: 'a',
            name: 'm2mac',
            state: 'offline',
            lastSeenAt: now - 4 * 60 * 60_000,
            downSince: now - 4 * 60 * 60_000 + 5_000,
            lastOutage: null
          },
          {
            environmentId: 'b',
            name: 'kif',
            state: 'up',
            lastSeenAt: now,
            downSince: null,
            lastOutage: { downtimeMs: 12 * 60_000, endedAt: now - 60_000 }
          }
        ],
        heartbeat: { state: 'failing', lastOkAt: now - 60_000 }
      },
      now
    )
    expect(text).toContain('Offline alert after 5 min')
    expect(text).toMatch(/m2mac\s+offline\s+2026-11-17 10:00\s+for 4 h/)
    expect(text).toMatch(/kif\s+answering\s+2026-11-17 14:00\s+last outage 12 min/)
    expect(text).toContain('Heartbeat: failing, last success 2026-11-17 13:59')
  })

  it('says when health is off', () => {
    const text = formatServerHealth({
      enabled: false,
      offlineMinutes: 5,
      servers: [],
      heartbeat: { state: 'invalid', lastOkAt: null }
    })
    expect(text).toContain('Server health is off')
    expect(text).toContain('Heartbeat: off, the address is not a valid http(s) URL')
  })
})
