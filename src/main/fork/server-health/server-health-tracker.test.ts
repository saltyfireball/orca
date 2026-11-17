import { describe, expect, it } from 'vitest'
import { ServerHealthTracker, type ServerConnectionReading } from './server-health-tracker'

const SERVER = { id: 'env-1', name: 'build-box' }
const CONFIG = { offlineMs: 5 * 60_000, recoveryMs: 60_000 }
const TICK = 5_000

/** Feeds one reading every 5 s for `ms`, starting at `from`; returns the alerts and the end time. */
function feed(
  tracker: ServerHealthTracker,
  reading: ServerConnectionReading,
  from: number,
  ms: number
): { alerts: ReturnType<ServerHealthTracker['observe']>; end: number } {
  const alerts: ReturnType<ServerHealthTracker['observe']> = []
  let now = from
  for (; now < from + ms; now += TICK) {
    alerts.push(...tracker.observe(SERVER, reading, now, CONFIG))
  }
  return { alerts, end: now }
}

describe('ServerHealthTracker', () => {
  it('sends one offline alert after the offline time, and one back alert with the downtime', () => {
    const tracker = new ServerHealthTracker()
    let t = feed(tracker, 'ready', 0, 60_000)
    expect(t.alerts).toEqual([])
    const downAt = t.end
    t = feed(tracker, 'down', downAt, 4 * 60_000)
    expect(t.alerts).toEqual([])
    expect(tracker.list()[0]).toMatchObject({ state: 'down', downSince: downAt })
    t = feed(tracker, 'down', t.end, 3 * 60_000)
    expect(t.alerts).toHaveLength(1)
    expect(t.alerts[0]).toMatchObject({
      kind: 'offline',
      downSince: downAt,
      lastSeenAt: downAt - TICK,
      at: downAt + 5 * 60_000
    })
    // Still down: no second alert.
    t = feed(tracker, 'down', t.end, 30 * 60_000)
    expect(t.alerts).toEqual([])
    const upAt = t.end
    t = feed(tracker, 'ready', upAt, 2 * 60_000)
    expect(t.alerts).toHaveLength(1)
    expect(t.alerts[0]).toMatchObject({
      kind: 'recovered',
      downSince: downAt,
      downtimeMs: upAt - downAt,
      at: upAt + 60_000
    })
    expect(tracker.list()[0]).toMatchObject({
      state: 'up',
      downSince: null,
      lastOutage: { downtimeMs: upAt - downAt, endedAt: upAt + 60_000 }
    })
  })

  it('never alerts for a drop shorter than the offline time', () => {
    const tracker = new ServerHealthTracker()
    let t = feed(tracker, 'ready', 0, 30_000)
    t = feed(tracker, 'down', t.end, 4 * 60_000)
    t = feed(tracker, 'ready', t.end, 2 * 60_000)
    t = feed(tracker, 'down', t.end, 4 * 60_000)
    expect(t.alerts).toEqual([])
    expect(tracker.list()[0].state).toBe('down')
  })

  it('does not spam while a server flaps: one alert pair per outage', () => {
    const tracker = new ServerHealthTracker()
    const all: ReturnType<ServerHealthTracker['observe']> = []
    let t = feed(tracker, 'down', 0, 6 * 60_000)
    all.push(...t.alerts)
    // Flapping: answers for 30 s (under the 60 s recovery time), then drops, for an hour.
    for (let i = 0; i < 40; i += 1) {
      t = feed(tracker, 'ready', t.end, 30_000)
      all.push(...t.alerts)
      t = feed(tracker, 'down', t.end, 60_000)
      all.push(...t.alerts)
    }
    expect(all.map((a) => a.kind)).toEqual(['offline'])
    t = feed(tracker, 'ready', t.end, 2 * 60_000)
    expect(t.alerts.map((a) => a.kind)).toEqual(['recovered'])
  })

  it('counts a flapping drop from its first failure, so a mostly-down server still alerts', () => {
    const tracker = new ServerHealthTracker()
    const all: ReturnType<ServerHealthTracker['observe']> = []
    let t = { alerts: [] as ReturnType<ServerHealthTracker['observe']>, end: 0 }
    for (let i = 0; i < 4; i += 1) {
      t = feed(tracker, 'down', t.end, 2 * 60_000)
      all.push(...t.alerts)
      t = feed(tracker, 'ready', t.end, 20_000)
      all.push(...t.alerts)
    }
    expect(all.map((a) => a.kind)).toEqual(['offline'])
  })

  it('does not count time the desktop itself was asleep', () => {
    const tracker = new ServerHealthTracker()
    tracker.observe(SERVER, 'ready', 0, CONFIG)
    tracker.observe(SERVER, 'down', 5_000, CONFIG)
    // Two hours with no reading (lid closed), then still down on wake.
    const wake = 2 * 60 * 60_000
    expect(tracker.observe(SERVER, 'down', wake, CONFIG)).toEqual([])
    expect(tracker.list()[0].downSince).toBe(wake)
    // Back within the minute it takes to reconnect: no alert at all.
    const t = feed(tracker, 'ready', wake + TICK, 2 * 60_000)
    expect(t.alerts).toEqual([])
  })

  it('a server it holds no connection to is not watched and never alerts', () => {
    const tracker = new ServerHealthTracker()
    const t = feed(tracker, 'idle', 0, 60 * 60_000)
    expect(t.alerts).toEqual([])
    expect(tracker.list()[0]).toMatchObject({ state: 'unwatched', lastSeenAt: null })
  })

  it('a zero recovery time counts a server back at its first answer', () => {
    const tracker = new ServerHealthTracker()
    const config = { offlineMs: 60_000, recoveryMs: 0 }
    tracker.observe(SERVER, 'down', 0, config)
    expect(tracker.observe(SERVER, 'down', 60_000, config).map((a) => a.kind)).toEqual(['offline'])
    const back = tracker.observe(SERVER, 'ready', 65_000, config)
    expect(back).toMatchObject([{ kind: 'recovered', downtimeMs: 65_000 }])
  })

  it('forgets servers that are no longer saved', () => {
    const tracker = new ServerHealthTracker()
    tracker.observe(SERVER, 'ready', 0, CONFIG)
    tracker.observe({ id: 'env-2', name: 'a-box' }, 'ready', 0, CONFIG)
    expect(tracker.list().map((s) => s.name)).toEqual(['a-box', 'build-box'])
    tracker.retain(new Set(['env-2']))
    expect(tracker.list().map((s) => s.environmentId)).toEqual(['env-2'])
  })
})
