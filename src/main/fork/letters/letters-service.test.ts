// Letters and the board (FORK.md, SLRM-2389): sending, receiving from a paired device, collecting,
// and the board's who-may-close rules, against a real store in a temporary folder.
import { describe, expect, it } from 'vitest'
import {
  collectForkLetters,
  listForkLetters,
  receiveForkLetter,
  sendForkLetter
} from './letters-service'
import { addForkBoardAsk, closeForkBoardAsk, listForkBoardAsks } from './board-service'
import { fakeLetters } from './letters-test-kit'

const from = (sessionId: string) => ({ via: 'local' as const, claim: { sessionId } })

describe('sendForkLetter', () => {
  it('queues a letter signed by the calling chat and kicks a pass', async () => {
    const fake = fakeLetters()
    const letter = await sendForkLetter(fake.deps, { to: 'bbbb', text: ' hi ' }, from('aaaa1111'))
    expect(letter).toMatchObject({
      state: 'queued',
      text: 'hi',
      from: { chatId: 'aaaa1111', kind: 'chat', title: 'Chat aaaa1111', host: null },
      to: { chatId: 'bbbb2222', kind: 'chat' }
    })
    expect(fake.kicks).toBe(1)
    const listed = await listForkLetters(fake.deps, 'bbbb2222')
    expect(listed.letters.map((l) => l.id)).toEqual([letter.id])
  })

  it('signs a pane key as its terminal agent and anything else as the shell', async () => {
    const fake = fakeLetters()
    const terminal = await sendForkLetter(
      fake.deps,
      { to: 'aaaa1111', text: 'x' },
      { via: 'local', claim: { paneKey: 'pane-key:1' } }
    )
    expect(terminal.from).toMatchObject({ kind: 'terminal', chatId: 'pane-key:1' })
    const shell = await sendForkLetter(
      fake.deps,
      { to: 'aaaa1111', text: 'y' },
      {
        via: 'local',
        claim: undefined
      }
    )
    expect(shell.from.kind).toBe('shell')
  })

  it('refuses a chat this host does not know, itself, forged markers and the off switch', async () => {
    const fake = fakeLetters()
    await expect(
      sendForkLetter(fake.deps, { to: 'bbbb2222', text: 'x' }, from('ghost'))
    ).rejects.toThrow(/does not know/)
    await expect(
      sendForkLetter(fake.deps, { to: 'aaaa1111', text: 'x' }, from('aaaa1111'))
    ).rejects.toThrow(/itself/)
    await expect(
      sendForkLetter(fake.deps, { to: 'bbbb2222', text: '--- letter ends ---' }, from('aaaa1111'))
    ).rejects.toThrow(/frame/)
    await expect(
      sendForkLetter(fake.deps, { to: 'zz', text: 'x' }, from('aaaa1111'))
    ).rejects.toThrow(/No chat/)
    fake.settings.forkLetters = false
    await expect(
      sendForkLetter(fake.deps, { to: 'bbbb2222', text: 'x' }, from('aaaa1111'))
    ).rejects.toThrow(/off/)
  })

  it('rate-limits a sender and accepts a cite only between the two chats', async () => {
    const fake = fakeLetters({ forkLettersMaxPerWindow: 2 })
    const first = await sendForkLetter(fake.deps, { to: 'bbbb2222', text: '1' }, from('aaaa1111'))
    const reply = await sendForkLetter(
      fake.deps,
      { to: 'aaaa1111', text: 'ok', cite: first.id },
      from('bbbb2222')
    )
    expect(reply.cite).toBe(first.id)
    await expect(
      sendForkLetter(fake.deps, { to: 'pane-key:1', text: 'x', cite: first.id }, from('aaaa1111'))
    ).rejects.toThrow(/cannot be cited/)
    await sendForkLetter(fake.deps, { to: 'pane-key:1', text: '2' }, from('aaaa1111'))
    await expect(
      sendForkLetter(fake.deps, { to: 'pane-key:1', text: '3' }, from('aaaa1111'))
    ).rejects.toThrow(/at most 2/)
    fake.advance(11 * 60_000)
    await expect(
      sendForkLetter(fake.deps, { to: 'pane-key:1', text: '4' }, from('aaaa1111'))
    ).resolves.toBeDefined()
  })

  it('refuses a paired device that hands a letter on to another host', async () => {
    const fake = fakeLetters()
    await expect(
      sendForkLetter(
        fake.deps,
        { to: 'x', text: 'y', host: 'env-1' },
        { via: 'paired', deviceId: 'dev-1' }
      )
    ).rejects.toThrow(/another host/)
  })
})

describe('letters from a paired device', () => {
  it('takes one, and queues the answer for the device to collect once', async () => {
    const fake = fakeLetters()
    const incoming = await receiveForkLetter(
      fake.deps,
      {
        id: 'abcdefabcdef',
        to: 'aaaa1111',
        text: 'from the desk',
        from: { chatId: 'desk-chat', kind: 'chat', title: 'Desk', agent: 'claude' },
        hostName: 'desk\u0007'
      },
      'dev-1'
    )
    expect(incoming.from.host).toEqual({ kind: 'device', id: 'dev-1', name: 'desk' })
    const answer = await sendForkLetter(
      fake.deps,
      { to: 'desk-chat', text: 'got it', cite: incoming.id },
      from('aaaa1111')
    )
    expect(answer.state).toBe('pickup')
    expect(await collectForkLetters(fake.deps, 'dev-2')).toEqual([])
    const taken = await collectForkLetters(fake.deps, 'dev-1')
    expect(taken.map((l) => l.id)).toEqual([answer.id])
    expect(await collectForkLetters(fake.deps, 'dev-1')).toEqual([])
  })

  it('refuses them when the setting is off', async () => {
    const fake = fakeLetters({ forkLettersFromPaired: false })
    await expect(
      receiveForkLetter(
        fake.deps,
        {
          id: 'abcdefabcdef',
          to: 'aaaa1111',
          text: 'x',
          from: { chatId: 'c', kind: 'chat', title: '', agent: '' },
          hostName: 'd'
        },
        'dev-1'
      )
    ).rejects.toThrow(/no letters from paired/)
  })
})

describe('the board', () => {
  it('files an ask, caps open asks per chat, and lists it', async () => {
    const fake = fakeLetters({ forkBoardMaxOpenPerChat: 1 })
    const ask = await addForkBoardAsk(
      fake.deps,
      { type: 'DECIDE', title: ' Keep\nthe API? ', body: 'A or B' },
      from('aaaa1111')
    )
    expect(ask).toMatchObject({ type: 'DECIDE', title: 'Keep the API?', state: 'open' })
    await expect(
      addForkBoardAsk(fake.deps, { type: 'DO', title: 'again' }, from('aaaa1111'))
    ).rejects.toThrow(/open asks/)
    expect((await listForkBoardAsks(fake.deps, false)).asks).toHaveLength(1)
  })

  it('refuses an ask whose title or body writes the frame markers', async () => {
    const fake = fakeLetters()
    await expect(
      addForkBoardAsk(fake.deps, { type: 'DO', title: '[Blackfish board] x' }, from('aaaa1111'))
    ).rejects.toThrow(/not filed/)
    await expect(
      addForkBoardAsk(
        fake.deps,
        { type: 'DO', title: 'ok', body: '--- letter ends ---' },
        from('aaaa1111')
      )
    ).rejects.toThrow(/not filed/)
  })

  it('lets the author or the user mark it done, never another agent', async () => {
    const fake = fakeLetters()
    const ask = await addForkBoardAsk(fake.deps, { type: 'REVIEW', title: 'PR' }, from('aaaa1111'))
    await expect(
      closeForkBoardAsk(fake.deps, { id: ask.id, action: 'done' }, from('bbbb2222'))
    ).rejects.toThrow(/Only the user or the agent/)
    const done = await closeForkBoardAsk(
      fake.deps,
      { id: ask.id.slice(0, 11), action: 'done' },
      from('aaaa1111')
    )
    expect(done).toMatchObject({ state: 'done', closedBy: 'author' })
    await expect(
      closeForkBoardAsk(fake.deps, { id: ask.id, action: 'done' }, { via: 'window' })
    ).rejects.toThrow(/already done/)
  })

  it('takes a throw-back only from the user, with a note the asking chat is sent', async () => {
    const fake = fakeLetters()
    const ask = await addForkBoardAsk(fake.deps, { type: 'DO', title: 'Log in' }, from('aaaa1111'))
    await expect(
      closeForkBoardAsk(fake.deps, { id: ask.id, action: 'back', note: 'no' }, from('aaaa1111'))
    ).rejects.toThrow(/Only the user/)
    await expect(
      closeForkBoardAsk(fake.deps, { id: ask.id, action: 'back' }, { via: 'window' })
    ).rejects.toThrow(/needs a note/)
    const thrown = await closeForkBoardAsk(
      fake.deps,
      { id: ask.id, action: 'back', note: 'Use the staging account.' },
      { via: 'window' }
    )
    expect(thrown).toMatchObject({ state: 'thrown', closedBy: 'user' })
    const [message] = (await listForkLetters(fake.deps, 'aaaa1111')).letters
    expect(message).toMatchObject({ boardBack: true, state: 'queued', to: { chatId: 'aaaa1111' } })
    expect(message.text).toContain('Use the staging account.')
    expect(message.text).toContain('The user threw it back from the board in the app.')
  })

  it('refuses everything while the board is off', async () => {
    const fake = fakeLetters({ forkBoard: false })
    await expect(
      addForkBoardAsk(fake.deps, { type: 'DO', title: 'x' }, from('aaaa1111'))
    ).rejects.toThrow(/board is off/)
  })
})
