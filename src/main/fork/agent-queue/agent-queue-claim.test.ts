import { describe, expect, it } from 'vitest'
import { claimThroughGate } from './agent-queue-claim'
import { testGate, type TestGate } from './agent-queue-test-gate'

type Outcome = { ok: boolean; delivered: string[] }

/**
 * A chat as the native start funnel drives it: messages land in its journal at once, and the
 * delivery loop sends everything pending once its provider start resolves.
 */
function fakeChat(t: TestGate, key: string, kind: 'interactive' | 'worker' = 'interactive') {
  const journal: string[] = []
  const delivered: string[] = []
  let starts = 0
  const claim = (): Promise<Outcome> =>
    claimThroughGate<Outcome>(t.gate, {
      key,
      request: () => ({ key, kind, label: key }),
      start: async (refusal) => {
        if (refusal) {
          return refusal
        }
        starts++
        t.live.set(key, kind)
        delivered.push(...journal.splice(0))
        return { ok: true, delivered: [...delivered] }
      },
      reclaim: () => claim(),
      cancelled: () => ({ ok: false, delivered: [] })
    })
  return {
    send(text: string): Promise<Outcome> {
      journal.push(text)
      return claim()
    },
    journal,
    delivered,
    starts: () => starts
  }
}

describe('claimThroughGate', () => {
  it('runs the start at once when there is room', async () => {
    const t = testGate()
    const chat = fakeChat(t, 'a')
    await expect(chat.send('hi')).resolves.toEqual({
      ok: true,
      delivered: ['hi']
    })
  })

  it('holds messages sent to a queued chat and delivers them all on start', async () => {
    const t = testGate({ maxLive: 1 })
    t.live.set('busy', 'interactive')
    const chat = fakeChat(t, 'q')
    const first = chat.send('one')
    const second = chat.send('two')
    await Promise.resolve()
    expect(chat.delivered).toEqual([])
    expect(chat.journal).toEqual(['one', 'two'])
    expect(t.gate.entries()).toHaveLength(1)
    t.live.delete('busy')
    t.poll()
    const outcomes = await Promise.all([first, second])
    expect(chat.delivered).toEqual(['one', 'two'])
    expect(chat.starts()).toBe(1)
    expect(outcomes[0].ok).toBe(true)
  })

  it('refuses the waiting start on cancel and keeps the messages unsent', async () => {
    const t = testGate({ maxLive: 1 })
    t.live.set('busy', 'interactive')
    const chat = fakeChat(t, 'q')
    const sent = chat.send('one')
    await Promise.resolve()
    t.gate.cancel(t.gate.entries()[0].id)
    await expect(sent).resolves.toEqual({ ok: false, delivered: [] })
    expect(chat.starts()).toBe(0)
    expect(chat.journal).toEqual(['one'])
    // Sending again queues it again.
    void chat.send('two')
    await Promise.resolve()
    expect(t.gate.entries()).toHaveLength(1)
  })

  it('releases the slot reservation once the start settles, even when it fails', async () => {
    const t = testGate({ maxLive: 1 })
    const failing = claimThroughGate<Outcome>(t.gate, {
      key: 'crash',
      request: () => ({ key: 'crash', kind: 'interactive', label: 'crash' }),
      start: () => Promise.reject(new Error('spawn failed')),
      reclaim: () => Promise.reject(new Error('unused')),
      cancelled: () => ({ ok: false, delivered: [] })
    })
    const next = fakeChat(t, 'next')
    const sent = next.send('hi')
    await expect(failing).rejects.toThrow('spawn failed')
    await expect(sent).resolves.toEqual({ ok: true, delivered: ['hi'] })
  })
})
