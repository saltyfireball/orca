import { describe, expect, it } from 'vitest'
import type { GateDecision, GateRequest } from './agent-launch-gate'
import { testGate, type TestGate } from './agent-queue-test-gate'

function ask(t: TestGate, key: string, extra: Partial<GateRequest> = {}): GateDecision {
  return t.gate.request({ key, kind: 'interactive', label: key, ...extra })
}

/** Admit a launch and mark its process running, as a real start would. */
function run(t: TestGate, key: string, extra: Partial<GateRequest> = {}): void {
  expect(ask(t, key, extra).state).toBe('admitted')
  t.live.set(key, extra.kind ?? 'interactive')
  t.gate.release(key)
}

function order(t: TestGate): string[] {
  return t.gate.entries().map((entry) => entry.sessionId)
}

describe('AgentLaunchGate', () => {
  it('admits everything while the limit is off', () => {
    const t = testGate({ enabled: false })
    for (const key of ['a', 'b', 'c', 'd']) {
      expect(ask(t, key).state).toBe('admitted')
    }
    expect(t.gate.entries()).toEqual([])
  })

  it('queues past the limit with a position, first come first served', () => {
    const t = testGate()
    run(t, 'a')
    run(t, 'b')
    const c = ask(t, 'c')
    const d = ask(t, 'd')
    expect(c.state === 'queued' && c.entry.position).toBe(1)
    expect(d.state === 'queued' && d.entry.position).toBe(2)
    expect(order(t)).toEqual(['c', 'd'])
  })

  it('counts an admitted launch before its process shows, so a burst cannot slip through', () => {
    const t = testGate()
    expect(ask(t, 'a').state).toBe('admitted')
    expect(ask(t, 'b').state).toBe('admitted')
    expect(ask(t, 'c').state).toBe('queued')
  })

  it('starts user launches ahead of workers, arrival order within each', () => {
    const t = testGate()
    run(t, 'a')
    run(t, 'b')
    ask(t, 'w1', { kind: 'worker' })
    ask(t, 'i1')
    ask(t, 'w2', { kind: 'worker' })
    ask(t, 'i2')
    expect(order(t)).toEqual(['i1', 'i2', 'w1', 'w2'])
  })

  it('starts the next launch when a running agent exits (seen on the poll)', async () => {
    const t = testGate()
    run(t, 'a')
    run(t, 'b')
    const c = ask(t, 'c')
    expect(t.pendingPolls()).toBe(1)
    t.live.delete('a')
    t.poll()
    expect(c.state === 'queued' && (await c.settled)).toBe('admitted')
    expect(t.gate.consume('c')).toBe('admitted')
    expect(t.gate.entries()).toEqual([])
  })

  it('frees a crashed launch slot: a start that never shows a process holds it only until it fails', async () => {
    const t = testGate({ maxLive: 1 })
    expect(ask(t, 'a').state).toBe('admitted')
    const b = ask(t, 'b')
    expect(b.state).toBe('queued')
    // The start failed or crashed before its process showed: the claim releases it.
    t.gate.release('a')
    expect(b.state === 'queued' && (await b.settled)).toBe('admitted')
  })

  it('lets a stale reservation lapse so a lost start cannot hold a slot forever', async () => {
    const t = testGate({ maxLive: 1 })
    expect(ask(t, 'a').state).toBe('admitted')
    const b = ask(t, 'b')
    t.clock.now += 61_000
    t.poll()
    expect(b.state === 'queued' && (await b.settled)).toBe('admitted')
  })

  it('skips the queue on start now, past the limit', async () => {
    const t = testGate()
    run(t, 'a')
    run(t, 'b')
    ask(t, 'c')
    const d = ask(t, 'd')
    const id = d.state === 'queued' ? d.entry.id : ''
    expect(t.gate.startNow(id)).toBe(true)
    expect(d.state === 'queued' && (await d.settled)).toBe('admitted')
    expect(order(t)).toEqual(['c'])
    expect(t.gate.startNow(id)).toBe(false)
  })

  it('cancels a queued launch and moves the rest up', async () => {
    const t = testGate()
    run(t, 'a')
    run(t, 'b')
    const c = ask(t, 'c')
    ask(t, 'd')
    expect(t.gate.cancel(c.state === 'queued' ? c.entry.id : '')).toBe(true)
    expect(c.state === 'queued' && (await c.settled)).toBe('cancelled')
    expect(t.gate.consume('c')).toBe('cancelled')
    expect(t.gate.entries().map((entry) => [entry.sessionId, entry.position])).toEqual([['d', 1]])
  })

  it('joins the waiting ticket when the same chat asks again', () => {
    const t = testGate({ maxLive: 1 })
    run(t, 'a')
    const first = ask(t, 'b')
    const again = ask(t, 'b')
    expect(first.state === 'queued' && again.state === 'queued' && again.entry.id).toBe(
      first.state === 'queued' ? first.entry.id : 'x'
    )
    expect(t.gate.entries()).toHaveLength(1)
  })

  it('never holds a chat that wakes while resume bypass is on', () => {
    const t = testGate({ maxLive: 1 })
    run(t, 'a')
    expect(ask(t, 'old', { resume: true }).state).toBe('admitted')
    t.config = { ...t.config, resumeBypass: false }
    expect(ask(t, 'old2', { resume: true }).state).toBe('queued')
  })

  it('keeps separate pools when workers have their own limit', () => {
    const t = testGate({ separate: true, maxLive: 1, maxWorkers: 1 })
    run(t, 'chat')
    expect(ask(t, 'w1', { kind: 'worker' }).state).toBe('admitted')
    expect(ask(t, 'w2', { kind: 'worker' }).state).toBe('queued')
    expect(ask(t, 'chat2').state).toBe('queued')
  })

  it('holds new launches while the memory seam says so, and starts them when it lifts', async () => {
    const t = testGate({ maxLive: 5 })
    t.hold = { hold: true, reason: 'low memory' }
    const a = ask(t, 'a')
    expect(a.state).toBe('queued')
    t.hold = { hold: false }
    t.gate.notify()
    expect(a.state === 'queued' && (await a.settled)).toBe('admitted')
  })

  it('starts everything waiting when the limit is switched off', async () => {
    const t = testGate({ maxLive: 1 })
    run(t, 'a')
    const b = ask(t, 'b')
    const c = ask(t, 'c', { kind: 'worker' })
    t.config = { ...t.config, enabled: false }
    t.gate.notify()
    expect(b.state === 'queued' && (await b.settled)).toBe('admitted')
    expect(c.state === 'queued' && (await c.settled)).toBe('admitted')
    expect(t.pendingPolls()).toBe(0)
  })

  it('does not deadlock when every running agent waits on a queued launch of its own', async () => {
    const t = testGate()
    run(t, 'coordA')
    run(t, 'coordB')
    const childA = ask(t, 'childA', { kind: 'worker', parentKey: 'coordA' })
    const childB = ask(t, 'childB', { kind: 'worker', parentKey: 'coordB' })
    // Only the full pool's every member waiting matters, and only the oldest child goes past it.
    expect(childA.state === 'queued' && (await childA.settled)).toBe('admitted')
    expect(order(t)).toEqual(['childB'])
    expect(childB.state).toBe('queued')
  })

  it('keeps the limit when a running agent is not waiting on anything', () => {
    const t = testGate()
    run(t, 'coord')
    run(t, 'busy')
    ask(t, 'child', { kind: 'worker', parentKey: 'coord' })
    expect(order(t)).toEqual(['child'])
  })
})
