import { describe, expect, it } from 'vitest'
import type { Bot } from '../../../../shared/bot-types'
import { makeTestBotItem } from '../../../../shared/bots/bot-item.test-fixture'
import {
  forkBotAskAnswerable,
  forkBotAskLine,
  forkBotAskNotice,
  forkBotAsksOf,
  forkBotRowAskPick,
  forkBotsWithAsks
} from './bot-asks-view'

const DAY = 24 * 60 * 60_000
const NOW = 100 * DAY

function bot(id: string, fields: Partial<Bot> = {}): Bot {
  return { id, name: `Bot ${id}`, hostId: 'local', ...fields } as Bot
}

const ask = {
  questions: [{ prompt: 'Upgrade Linear to Basic?', options: [{ label: 'Yes' }, { label: 'No' }] }]
}

describe('forkBotAsksOf', () => {
  it('lists only items waiting on the owner, oldest first, across bots', () => {
    const asks = forkBotAsksOf(
      [
        {
          bot: bot('a'),
          items: [
            makeTestBotItem(1, { status: 'working', lastActivityAt: NOW - 3 }),
            makeTestBotItem(2, {
              status: 'needs_you',
              lastActivityAt: NOW - 1,
              question: { eventId: 'e5', text: 'Which one?' }
            })
          ]
        },
        {
          bot: bot('b', { hostId: 'runtime:server' as Bot['hostId'] }),
          items: [makeTestBotItem(7, { status: 'needs_you', lastActivityAt: NOW - 2 })]
        }
      ],
      NOW
    )
    expect(asks.map((entry) => entry.item.number)).toEqual([7, 2])
    expect(asks[1]!.key).toBe('local|a|uid-2|e5')
    // An item set to Needs you with no question is keyed by its last event.
    expect(asks[0]!.key).toBe('runtime:server|b|uid-7|e10')
  })

  it('leaves out snoozed and stale asks, by the bot own stale days', () => {
    const asks = forkBotAsksOf(
      [
        {
          bot: bot('a'),
          items: [
            makeTestBotItem(1, { status: 'needs_you', snoozedUntil: NOW + DAY }),
            makeTestBotItem(2, { status: 'needs_you', lastActivityAt: NOW - 6 * DAY }),
            makeTestBotItem(3, { status: 'needs_you', lastActivityAt: NOW - DAY })
          ]
        },
        {
          bot: bot('never', { itemsStale: 'never' }),
          items: [makeTestBotItem(4, { status: 'needs_you', lastActivityAt: NOW - 60 * DAY })]
        }
      ],
      NOW
    )
    expect(asks.map((entry) => entry.item.number)).toEqual([4, 3])
  })

  it('gives a new key to a new question on the same item', () => {
    const read = (eventId: string) =>
      forkBotAsksOf(
        [
          {
            bot: bot('a'),
            items: [
              makeTestBotItem(1, {
                status: 'needs_you',
                lastActivityAt: NOW,
                question: { eventId, text: 'Q' }
              })
            ]
          }
        ],
        NOW
      )[0]!.key
    expect(read('e5')).not.toBe(read('e9'))
  })
})

describe('forkBotAskLine and forkBotAskAnswerable', () => {
  it('reads the question first line plainly, else its first decision, else the title', () => {
    const item = makeTestBotItem(1, { title: 'Linear plan' })
    expect(forkBotAskLine({ item, question: { eventId: 'e1', text: '**Upgrade?**\nmore' } })).toBe(
      'Upgrade?'
    )
    expect(forkBotAskLine({ item, question: { eventId: 'e1', text: '', ask } })).toBe(
      'Upgrade Linear to Basic?'
    )
    expect(forkBotAskLine({ item, question: null })).toBe('Linear plan')
  })

  it('answers in place only an ask with decisions on a host that records answers', () => {
    expect(
      forkBotAskAnswerable({ question: { eventId: 'e1', text: 'Q', ask, answerable: true } })
    ).toBe(true)
    expect(forkBotAskAnswerable({ question: { eventId: 'e1', text: 'Q', ask } })).toBe(false)
    expect(forkBotAskAnswerable({ question: { eventId: 'e1', text: 'Q', answerable: true } })).toBe(
      false
    )
    expect(forkBotAskAnswerable({ question: null })).toBe(false)
  })
})

describe('forkBotAskNotice', () => {
  it('names the bot, the item and the question, and marks an ask on screen', () => {
    const [entry] = forkBotAsksOf(
      [
        {
          bot: bot('a'),
          items: [
            makeTestBotItem(3, {
              status: 'needs_you',
              lastActivityAt: NOW,
              title: 'Linear plan',
              question: { eventId: 'e5', text: 'Upgrade?' }
            })
          ]
        }
      ],
      NOW
    )
    expect(forkBotAskNotice(entry!, false)).toEqual({
      key: 'local|a|uid-3|e5',
      bot: 'Bot builder',
      title: 'Linear plan',
      question: 'Upgrade?'
    })
    expect(forkBotAskNotice(entry!, true).onScreen).toBe(true)
  })
})

describe('forkBotsWithAsks', () => {
  it('reads only bots their host counts asks for', () => {
    const counts: Record<string, number | null> = { a: 2, b: 0, c: null }
    expect(
      forkBotsWithAsks([bot('a'), bot('b'), bot('c')], (entry) => counts[entry.id] ?? null).map(
        (entry) => entry.id
      )
    ).toEqual(['a'])
  })
})

describe('forkBotRowAskPick', () => {
  const asks = forkBotAsksOf(
    [
      {
        bot: bot('a'),
        items: [1, 2, 3].map((n) =>
          makeTestBotItem(n, { status: 'needs_you', lastActivityAt: NOW - 10 + n })
        )
      }
    ],
    NOW
  )

  it('picks the first with none shown, and nothing with none waiting', () => {
    expect(forkBotRowAskPick(asks, null)?.item.uid).toBe('uid-1')
    expect(forkBotRowAskPick([], null)).toBeNull()
    expect(forkBotRowAskPick([], 'uid-1')).toBeNull()
  })

  it('moves to the next ask after the shown one, wrapping, and starts over for an answered one', () => {
    expect(forkBotRowAskPick(asks, 'uid-1')?.item.uid).toBe('uid-2')
    expect(forkBotRowAskPick(asks, 'uid-3')?.item.uid).toBe('uid-1')
    expect(forkBotRowAskPick(asks, 'uid-gone')?.item.uid).toBe('uid-1')
  })
})
