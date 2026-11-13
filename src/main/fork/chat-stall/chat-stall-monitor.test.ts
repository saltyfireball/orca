import { describe, expect, it, vi } from 'vitest'
import type { ForkChatStallEntry } from '../../../shared/fork/chat-stall'
import { ForkChatStallMonitor } from './chat-stall-monitor'
import type { ForkProviderTreeVerdict } from './chat-stall-probe'

const MIN = 60_000
const WINDOW = 30 * MIN

function rig(options: { autoRelease?: boolean; verdict?: ForkProviderTreeVerdict | null } = {}) {
  let now = 1_000_000
  let verdict: ForkProviderTreeVerdict | null =
    options.verdict === undefined ? { liveness: 'alive', stoppedPids: [] } : options.verdict
  const settings = { stallMs: WINDOW as number | null, autoRelease: options.autoRelease ?? false }
  const resume = vi.fn()
  const probe = vi.fn(async () => verdict)
  const changes: ForkChatStallEntry[][] = []
  const monitor = new ForkChatStallMonitor({
    now: () => now,
    settings: () => settings,
    probe,
    resume,
    onChange: (entries) => changes.push(entries)
  })
  return {
    monitor,
    probe,
    resume,
    changes,
    settings,
    advance: (ms: number) => {
      now += ms
    },
    setVerdict: (next: ForkProviderTreeVerdict | null) => {
      verdict = next
    },
    check: (progress = '1:5', ownerPid: number | null = 100) =>
      monitor.check('s1', { progress, ownerPid })
  }
}

describe('ForkChatStallMonitor', () => {
  it('holds and never probes below the window', async () => {
    const r = rig()
    await r.check()
    r.advance(WINDOW - 1)
    expect(await r.check()).toBe('hold')
    expect(r.probe).not.toHaveBeenCalled()
    expect(r.monitor.entries()).toEqual([])
  })

  it('marks a quiet chat stalled with its liveness, and never releases a live provider', async () => {
    const r = rig({ autoRelease: true })
    await r.check()
    r.advance(10 * WINDOW)
    expect(await r.check()).toBe('hold')
    expect(r.probe).toHaveBeenCalledWith(100)
    expect(r.monitor.entries()).toEqual([
      { sessionId: 's1', quietSince: 1_000_000, liveness: 'alive' }
    ])
    expect(r.changes.at(-1)).toHaveLength(1)
  })

  it('clears the mark when the chat records output again', async () => {
    const r = rig()
    await r.check()
    r.advance(WINDOW)
    await r.check()
    expect(r.monitor.entries()).toHaveLength(1)
    await r.check('1:6')
    expect(r.monitor.entries()).toEqual([])
    expect(r.changes.at(-1)).toEqual([])
  })

  it('reads unknown when the lease records no pid or the table cannot be read', async () => {
    const r = rig({ verdict: null })
    await r.check('1:5', null)
    r.advance(WINDOW)
    await r.check('1:5', null)
    expect(r.probe).not.toHaveBeenCalled()
    expect(r.monitor.entries()[0].liveness).toBe('unknown')
    await r.check('1:5', 100)
    expect(r.monitor.entries()[0].liveness).toBe('unknown')
  })

  it('auto releases a stopped provider only after twice the window, resuming it first', async () => {
    const r = rig({ autoRelease: true, verdict: { liveness: 'stopped', stoppedPids: [300] } })
    await r.check()
    r.advance(WINDOW)
    expect(await r.check()).toBe('hold')
    expect(r.monitor.entries()[0].liveness).toBe('stopped')
    r.advance(WINDOW)
    expect(await r.check()).toBe('release')
    expect(r.resume).toHaveBeenCalledWith(300)
    expect(r.monitor.entries()).toEqual([])
  })

  it('auto releases a gone provider, and never with auto release off', async () => {
    const off = rig({ verdict: { liveness: 'gone', stoppedPids: [] } })
    await off.check()
    off.advance(5 * WINDOW)
    expect(await off.check()).toBe('hold')
    const on = rig({ autoRelease: true, verdict: { liveness: 'gone', stoppedPids: [] } })
    await on.check()
    on.advance(2 * WINDOW)
    expect(await on.check()).toBe('release')
  })

  it('does not auto release an unknown provider', async () => {
    const r = rig({ autoRelease: true, verdict: null })
    await r.check()
    r.advance(5 * WINDOW)
    expect(await r.check()).toBe('hold')
  })

  it('releases on request, even a live provider, and kicks the sweep', async () => {
    const r = rig()
    const tick = vi.fn(async () => {})
    r.monitor.attachSweep(tick)
    await r.check()
    r.advance(WINDOW)
    await r.check()
    expect(await r.monitor.act('s1', 'release')).toBe(true)
    expect(tick).toHaveBeenCalledTimes(1)
    expect(await r.check()).toBe('release')
  })

  it('refuses actions on a chat that is not stalled', async () => {
    const r = rig()
    await r.check()
    expect(await r.monitor.act('s1', 'release')).toBe(false)
    expect(await r.monitor.act('other', 'wake')).toBe(false)
  })

  it('wakes a stopped provider with SIGCONT to each stopped process', async () => {
    const r = rig({ verdict: { liveness: 'stopped', stoppedPids: [300, 400] } })
    await r.check()
    r.advance(WINDOW)
    await r.check()
    r.resume.mockImplementationOnce(() => {
      throw new Error('ESRCH')
    })
    expect(await r.monitor.act('s1', 'wake')).toBe(true)
    expect(r.resume.mock.calls).toEqual([[300], [400]])
    expect(r.monitor.entries()[0].liveness).toBe('alive')
    r.setVerdict({ liveness: 'alive', stoppedPids: [] })
    expect(await r.monitor.act('s1', 'wake')).toBe(false)
  })

  it('forgets a chat the sweep no longer holds, and everything when turned off', async () => {
    const r = rig()
    await r.check()
    r.advance(WINDOW)
    await r.check()
    await r.monitor.check('s1', null)
    expect(r.monitor.entries()).toEqual([])
    await r.check()
    r.advance(WINDOW)
    await r.check()
    r.settings.stallMs = null
    expect(await r.check()).toBe('hold')
    expect(r.monitor.entries()).toEqual([])
  })

  it('drops a mark the sweep stopped asking about', async () => {
    const r = rig()
    await r.check()
    r.advance(WINDOW)
    await r.check()
    r.advance(21 * MIN)
    expect(r.monitor.entries()).toEqual([])
  })
})
