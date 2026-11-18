// Letters (FORK.md, SLRM-2389): a delivery pass types a letter in only between turns, one per
// recipient, never twice, and expires what waited a day.
import { describe, expect, it } from 'vitest'
import { runForkLetterDeliveryPass } from './letters-delivery'
import { listForkLetters, sendForkLetter } from './letters-service'
import { addForkBoardAsk, closeForkBoardAsk } from './board-service'
import { fakeLetters, idle } from './letters-test-kit'

const from = (sessionId: string) => ({ via: 'local' as const, claim: { sessionId } })

async function pass(fake: ReturnType<typeof fakeLetters>): Promise<number> {
  return runForkLetterDeliveryPass(fake.deps.store, fake.deps.ports(), fake.deps.now)
}

async function states(fake: ReturnType<typeof fakeLetters>): Promise<string[]> {
  return (await listForkLetters(fake.deps, undefined)).letters.map((l) => l.state).toReversed()
}

describe('runForkLetterDeliveryPass', () => {
  it('holds a letter while the chat is in a turn or asleep and delivers it once it rests', async () => {
    const fake = fakeLetters()
    await sendForkLetter(fake.deps, { to: 'bbbb2222', text: 'hello' }, from('aaaa1111'))
    fake.facts.set('bbbb2222', { ...idle, inTurn: true })
    expect(await pass(fake)).toBe(1)
    fake.facts.set('bbbb2222', { ...idle, loaded: false })
    expect(await pass(fake)).toBe(1)
    const held = (await listForkLetters(fake.deps, 'bbbb2222')).letters[0]
    expect(held.note).toBe('the chat is asleep')
    expect(fake.sent).toEqual([])
    fake.facts.set('bbbb2222', idle)
    expect(await pass(fake)).toBe(0)
    expect(fake.sent).toHaveLength(1)
    expect(fake.sent[0].text).toContain('--- letter begins ---\nhello\n--- letter ends ---')
    expect(await states(fake)).toEqual(['delivered'])
    await pass(fake)
    expect(fake.sent).toHaveLength(1)
  })

  it('checks again inside the send, and sends one letter per recipient per pass', async () => {
    const fake = fakeLetters()
    await sendForkLetter(fake.deps, { to: 'bbbb2222', text: 'one' }, from('aaaa1111'))
    await sendForkLetter(fake.deps, { to: 'bbbb2222', text: 'two' }, from('aaaa1111'))
    fake.facts.set('bbbb2222', idle)
    fake.busyAtSend.add('bbbb2222')
    await pass(fake)
    expect(fake.sent).toEqual([])
    fake.busyAtSend.clear()
    fake.facts.set('bbbb2222', idle)
    expect(await pass(fake)).toBe(1)
    expect(fake.sent.map((s) => s.text.includes('\none\n'))).toEqual([true])
    expect(await pass(fake)).toBe(0)
    expect(fake.sent).toHaveLength(2)
  })

  it('counts a send that may have arrived as delivered', async () => {
    const fake = fakeLetters()
    fake.outcome = 'unknown'
    await sendForkLetter(fake.deps, { to: 'bbbb2222', text: 'x' }, from('aaaa1111'))
    fake.facts.set('bbbb2222', idle)
    await pass(fake)
    expect(await states(fake)).toEqual(['delivered'])
  })

  it('types into a terminal agent only at an empty prompt', async () => {
    const fake = fakeLetters()
    await sendForkLetter(fake.deps, { to: 'pane-key:1', text: 'x' }, from('aaaa1111'))
    fake.terminalRefusal = 'draft'
    await pass(fake)
    expect((await listForkLetters(fake.deps, 'pane-key:1')).letters[0].note).toContain('draft')
    fake.terminalRefusal = null
    await pass(fake)
    expect(fake.sent.map((s) => s.to)).toEqual(['h-pane-key:1'])
  })

  it('types a throw-back as it is', async () => {
    const fake = fakeLetters()
    const ask = await addForkBoardAsk(fake.deps, { type: 'DO', title: 'Log in' }, from('aaaa1111'))
    await closeForkBoardAsk(
      fake.deps,
      { id: ask.id, action: 'back', note: 'Not yet.' },
      {
        via: 'window'
      }
    )
    fake.facts.set('aaaa1111', idle)
    await pass(fake)
    expect(fake.sent).toHaveLength(1)
    expect(fake.sent[0].text.startsWith('[Blackfish board: your DO ask')).toBe(true)
    expect(fake.sent[0].text).not.toContain('--- letter begins ---')
  })

  it('expires a letter after a day', async () => {
    const fake = fakeLetters()
    await sendForkLetter(fake.deps, { to: 'bbbb2222', text: 'late' }, from('aaaa1111'))
    fake.advance(25 * 60 * 60_000)
    expect(await pass(fake)).toBe(0)
    expect(await states(fake)).toEqual(['expired'])
  })
})
