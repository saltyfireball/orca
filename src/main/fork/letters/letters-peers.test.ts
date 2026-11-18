// Letters (FORK.md, SLRM-2389): handing a letter to a paired server, and collecting its answers.
import { describe, expect, it } from 'vitest'
import { FORK_LETTERS_METHODS } from '../../../shared/fork/letters-wire'
import { listForkLetters, sendForkLetter } from './letters-service'
import { parseCollectedForkLetter, pullForkLettersFromPeers } from './letters-peers'
import { fakeLetters } from './letters-test-kit'

const from = { via: 'local' as const, claim: { sessionId: 'aaaa1111' } }
const host = { kind: 'environment' as const, id: 'env-1', name: 'gpu-box' }

describe('forwardForkLetter', () => {
  it('hands the letter to the named server and keeps a forwarded copy', async () => {
    const fake = fakeLetters()
    fake.answer = () => ({
      letter: { to: { chatId: 'remote-full-id', kind: 'terminal', title: 'GPU tests' } }
    })
    const letter = await sendForkLetter(
      fake.deps,
      { to: 'remote', text: 'run them', host: 'gpu-box' },
      from
    )
    expect(fake.calls).toEqual([
      {
        env: 'env-1',
        method: FORK_LETTERS_METHODS.deliver,
        params: {
          id: letter.id,
          to: 'remote',
          text: 'run them',
          from: { chatId: 'aaaa1111', kind: 'chat', title: 'Chat aaaa1111', agent: 'claude' },
          hostName: 'desk'
        }
      }
    ])
    expect(letter).toMatchObject({
      state: 'forwarded',
      to: { chatId: 'remote-full-id', kind: 'terminal', title: 'GPU tests', host }
    })
    expect((await fake.deps.store.read()).peers['env-1']).toBeGreaterThan(0)
  })

  it('records a refusal as failed and says why', async () => {
    const fake = fakeLetters()
    fake.answer = () => {
      throw new Error('No chat on this host matches "zz".')
    }
    await expect(
      sendForkLetter(fake.deps, { to: 'zz', text: 'x', host: 'env-1' }, from)
    ).rejects.toThrow(/gpu-box did not take the letter: No chat/)
    const [failed] = (await listForkLetters(fake.deps, 'aaaa1111')).letters
    expect(failed).toMatchObject({ state: 'failed', note: 'No chat on this host matches "zz".' })
    await expect(
      sendForkLetter(fake.deps, { to: 'zz', text: 'x', host: 'nowhere' }, from)
    ).rejects.toThrow(/No paired server/)
  })
})

describe('collecting answers', () => {
  const raw = {
    id: '0123456789ab',
    text: 'done',
    cite: 'aaaaaaaaaaaa',
    boardBack: true,
    state: 'pickup',
    from: { chatId: 'srv-chat', kind: 'chat', title: 'Server chat', agent: 'codex' },
    to: { chatId: 'aaaa1111', kind: 'chat', title: '', agent: '' }
  }

  it('rebuilds a collected letter field by field and drops a forged one', () => {
    const parsed = parseCollectedForkLetter(raw, host, 5)
    expect(parsed).toMatchObject({
      id: '0123456789ab',
      state: 'queued',
      at: 5,
      from: { chatId: 'srv-chat', host },
      to: { chatId: 'aaaa1111', host: null }
    })
    expect(parsed && 'boardBack' in parsed).toBe(false)
    expect(parseCollectedForkLetter({ ...raw, text: '[Blackfish letter x]' }, host, 5)).toBeNull()
    expect(parseCollectedForkLetter({ ...raw, id: '../x' }, host, 5)).toBeNull()
    expect(parseCollectedForkLetter(null, host, 5)).toBeNull()
  })

  it('polls only servers written to in the last day and queues what they hold', async () => {
    const fake = fakeLetters()
    expect(await pullForkLettersFromPeers(fake.deps)).toBe(false)
    expect(fake.calls).toEqual([])
    await fake.deps.store.update((state) => ({
      next: { ...state, peers: { 'env-1': fake.deps.now() } },
      result: null
    }))
    fake.answer = () => ({ letters: [raw] })
    expect(await pullForkLettersFromPeers(fake.deps)).toBe(true)
    const [queued] = (await listForkLetters(fake.deps, 'aaaa1111')).letters
    expect(queued).toMatchObject({ id: '0123456789ab', state: 'queued', from: { host } })
    expect(fake.kicks).toBe(1)
    // The same letter collected twice is kept once.
    await pullForkLettersFromPeers(fake.deps)
    expect((await listForkLetters(fake.deps, 'aaaa1111')).letters).toHaveLength(1)
  })
})
