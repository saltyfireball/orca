import { afterEach, describe, expect, it } from 'vitest'
import type { BotItemBotActor } from './bot-items-input'
import { botItemChangeMail } from './bot-items-mail-text'
import { BotItemsStore } from './bot-items-store'

const bot: BotItemBotActor = { kind: 'bot', botId: 'bot-a', chatId: 'chat-home' }
const owner = { kind: 'owner' } as const
const stores: BotItemsStore[] = []

afterEach(() => stores.splice(0).forEach((store) => store.dispose()))

function openItem(): { store: BotItemsStore; uid: string } {
  const store = BotItemsStore.open(':memory:')
  stores.push(store)
  const { uid } = store.add(
    {
      ownerBotId: 'bot-a',
      chatId: 'chat-home',
      source: { kind: 'home', title: 'Home Chat' },
      title: 'Set up',
      status: 'planned',
      links: []
    },
    bot
  )
  return { store, uid }
}

const THREE = [
  { title: 'One', command: "tr -d '\\n' < token | secret set NAME", host: 'laptop' },
  { title: 'Two', command: 'echo two' },
  { title: 'Log in' }
]

function current(store: BotItemsStore, uid: string) {
  return store.viewRows([uid]).steps[uid] ?? null
}

describe('owner steps in the items store', () => {
  it('replaces the open steps with a new set and refuses a mark on the old one', () => {
    const { store, uid } = openItem()
    store.set(uid, { status: 'needs_you', steps: THREE }, bot)
    const first = current(store, uid)!
    store.set(uid, { status: 'needs_you', steps: [{ title: 'Only', command: 'echo only' }] }, bot)
    const second = current(store, uid)!

    expect(second.steps.map((step) => step.title)).toEqual(['Only'])
    expect(second.eventId).not.toBe(first.eventId)
    expect(() =>
      store.ownerStep(uid, { set: Number(first.eventId.slice(1)), index: 0, state: 'done' }, owner)
    ).toThrow(/new steps/)
  })

  it('records ticks silently and mails the chat once when the last one is ticked', () => {
    const { store, uid } = openItem()
    store.set(uid, { status: 'needs_you', steps: THREE }, bot)
    const set = Number(current(store, uid)!.eventId.slice(1))
    const owed = () => store.owedMail(0).mails.flatMap((mail) => mail.changes)
    const before = owed().length

    store.ownerStep(uid, { set, index: 0, state: 'done' }, owner)
    store.ownerStep(uid, { set, index: 1, state: 'done' }, owner)
    expect(owed()).toHaveLength(before)
    expect(current(store, uid)!.steps.map((step) => step.state)).toEqual(['done', 'done', 'open'])

    const last = store.ownerStep(uid, { set, index: 2, state: 'done' }, owner)
    expect(last.completed).toBe(true)
    const mails = store
      .owedMail(0)
      .mails.filter((mail) => mail.changes.some(({ event }) => event.kind === 'steps_done'))
    expect(mails).toHaveLength(1)
    // Unticking and ticking again does not mail a second time.
    store.ownerStep(uid, { set, index: 2, state: 'open' }, owner)
    expect(store.ownerStep(uid, { set, index: 2, state: 'done' }, owner).completed).toBe(false)
  })

  it('answers the ask as done on the last tick only when one option plainly says so', () => {
    const { store, uid } = openItem()
    const ask = (labels: string[]) => ({
      questions: [{ prompt: 'Ready?', options: labels.map((label) => ({ label })) }]
    })
    store.set(
      uid,
      {
        status: 'needs_you',
        steps: [{ title: 'A', command: 'a' }],
        ask: ask(['Done', 'Not yet']),
        comment: 'x'
      },
      bot
    )
    const set = Number(current(store, uid)!.eventId.slice(1))
    const result = store.ownerStep(uid, { set, index: 0, state: 'done', autoAnswer: true }, owner)
    expect(result.answered).toBe(true)
    expect(store.get(uid)?.status).toBe('working')

    const second = openItem()
    second.store.set(
      second.uid,
      {
        status: 'needs_you',
        steps: [{ title: 'A', command: 'a' }],
        ask: ask(['Yes', 'No']),
        comment: 'x'
      },
      bot
    )
    const set2 = Number(current(second.store, second.uid)!.eventId.slice(1))
    const unclear = second.store.ownerStep(
      second.uid,
      { set: set2, index: 0, state: 'done', autoAnswer: true },
      owner
    )
    expect(unclear.completed).toBe(true)
    expect(unclear.answered).toBe(false)
    expect(second.store.get(second.uid)?.status).toBe('needs_you')
  })

  it('mails a step that did not work at once, with its number and the error, and hands the item back', () => {
    const { store, uid } = openItem()
    store.set(uid, { status: 'needs_you', steps: THREE }, bot)
    const set = Number(current(store, uid)!.eventId.slice(1))
    expect(() => store.ownerStep(uid, { set, index: 1, state: 'failed' }, owner)).toThrow(/Paste/)
    store.ownerStep(uid, { set, index: 1, state: 'failed', error: 'permission denied' }, owner)

    const mail = botItemChangeMail(store.owedMail(0).mails.at(-1)!.changes)!
    expect(mail.body).toContain('step 2')
    expect(mail.body).toContain('permission denied')
    expect(store.get(uid)?.status).toBe('working')
    expect(current(store, uid)!.steps[1]).toMatchObject({
      state: 'failed',
      error: 'permission denied'
    })
  })
})
