import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/bot-hosts', () => ({
  botRefKey: (b: { hostId: string; id: string }) => `${b.hostId}:${b.id}`
}))

import {
  filterNeedsYouGroups,
  needsYouEntries,
  needsYouFlat,
  needsYouGroups,
  needsYouMove,
  needsYouNextEntry
} from './needs-you-view'
import { NOW, boardAsk, bot, botAsk, card, chat } from './needs-you-test-kit'

const A = bot('a')
const B = bot('b', 'ssh:paired-1')

function sources(over: Partial<Parameters<typeof needsYouEntries>[0]> = {}) {
  return {
    botAsks: [],
    chats: [],
    chatClockOffset: 0,
    board: [],
    boardClockOffset: 0,
    agents: [],
    ...over
  }
}

describe('needsYouEntries', () => {
  it('merges every kind of source, most recent first', () => {
    const entries = needsYouEntries(
      sources({
        botAsks: [botAsk(A, 10, NOW - 500)],
        chats: [chat('c1', NOW - 100)],
        board: [boardAsk('b1', NOW - 300)],
        agents: [card('p1', NOW - 200)]
      })
    )
    expect(entries.map((entry) => entry.target.kind)).toEqual(['chat', 'agent', 'board', 'bot-ask'])
  })

  it('shows the picture owner, number, title, question and host of a bot ask on a paired server', () => {
    const [entry] = needsYouEntries(
      sources({
        botAsks: [botAsk(B, 10, NOW)],
        hostLabelOf: (hostId) => (hostId === 'ssh:paired-1' ? 'Server one' : null)
      })
    )
    expect(entry).toMatchObject({
      bot: B,
      number: '#10',
      title: 'Item 10',
      line: 'Question 10?',
      hostId: 'ssh:paired-1',
      hostLabel: 'Server one'
    })
  })

  it('leaves the host off for this computer', () => {
    const [entry] = needsYouEntries(sources({ botAsks: [botAsk(A, 1, NOW)] }))
    expect(entry?.hostId).toBeNull()
    expect(entry?.hostLabel).toBeNull()
  })

  it('lists waiting and guard-paused chats, never stalled, paused or pull request rows', () => {
    const entries = needsYouEntries(
      sources({
        chats: [
          chat('waits', NOW - 1),
          chat('guard', NOW - 2, { verdict: 'guard' }),
          chat('stalled', NOW - 3, { verdict: 'stalled' }),
          chat('paused', NOW - 4, { paused: true })
        ]
      })
    )
    expect(entries.map((entry) => entry.groupKey)).toEqual(['chat:waits', 'chat:guard'])
  })

  it('moves a chat on a host clock to this window clock', () => {
    const [entry] = needsYouEntries(sources({ chats: [chat('c', 5_000)], chatClockOffset: 1_000 }))
    expect(entry?.since).toBe(6_000)
  })

  it('does not list an agent twice when the inbox lists its chat, or a subagent', () => {
    const entries = needsYouEntries(
      sources({
        chats: [chat('p1', NOW)],
        agents: [card('p1', NOW), card('p2', NOW - 1, { parentPaneKey: 'p9' }), card('p3', NOW - 2)]
      })
    )
    expect(entries.map((entry) => entry.key)).toEqual(['chat:idle:p1', 'agent:p3'])
  })

  it('shows an agent approval by its summary, and a board ask by its first line', () => {
    const entries = needsYouEntries(
      sources({ agents: [card('p1', NOW)], board: [boardAsk('b1', NOW - 1)] })
    )
    expect(entries[0]?.line).toBe('Allow Bash(rm)?')
    expect(entries[1]?.line).toBe('Body of b1')
  })
})

describe('needsYouGroups', () => {
  const entries = needsYouEntries(
    sources({
      botAsks: [botAsk(A, 1, NOW - 900), botAsk(A, 2, NOW - 100), botAsk(B, 3, NOW - 500)],
      // The board's asker is the chat that also waits: one group.
      chats: [chat('chat-b', NOW - 800)],
      board: [boardAsk('b1', NOW - 700)]
    })
  )

  it('groups by bot or agent, the group with the newest ask first, newest first inside', () => {
    const groups = needsYouGroups(entries)
    expect(groups.map((group) => group.key)).toEqual([
      'bot:local:a',
      'bot:ssh:paired-1:b',
      'chat:chat-b'
    ])
    expect(groups[0]?.entries.map((entry) => entry.number)).toEqual(['#2', '#1'])
    expect(groups[2]?.entries.map((entry) => entry.target.kind)).toEqual(['board', 'chat'])
  })

  it('flattens in the order shown', () => {
    expect(needsYouFlat(needsYouGroups(entries)).map((entry) => entry.key)).toHaveLength(5)
  })
})

describe('filterNeedsYouGroups', () => {
  const groups = needsYouGroups(
    needsYouEntries(
      sources({
        botAsks: [botAsk(A, 1, NOW - 2), botAsk(B, 2, NOW - 1, { title: 'Deploy plan' })],
        hostLabelOf: (id) => (id === 'ssh:paired-1' ? 'Server one' : null)
      })
    )
  )

  it('keeps the entries every word matches, across name, number, title, question and host', () => {
    expect(needsYouFlat(filterNeedsYouGroups(groups, 'deploy')).length).toBe(1)
    expect(needsYouFlat(filterNeedsYouGroups(groups, 'server one #2')).length).toBe(1)
    expect(needsYouFlat(filterNeedsYouGroups(groups, 'bot a question 1')).length).toBe(1)
    expect(filterNeedsYouGroups(groups, 'zzz')).toEqual([])
    expect(needsYouFlat(filterNeedsYouGroups(groups, '  ')).length).toBe(2)
  })
})

describe('needsYouMove', () => {
  it('wraps, and stays null with nothing listed', () => {
    expect(needsYouMove(0, 0, 1)).toBeNull()
    expect(needsYouMove(3, 2, 1)).toBe(0)
    expect(needsYouMove(3, 0, -1)).toBe(2)
    expect(needsYouMove(3, -1, 1)).toBe(0)
    expect(needsYouMove(3, -1, -1)).toBe(2)
  })
})

describe('needsYouNextEntry', () => {
  const entries = needsYouEntries(
    sources({ chats: [chat('c1', NOW - 1), chat('c2', NOW - 2), chat('c3', NOW - 3)] })
  )

  it('starts at the first, then the one after the last shown, wrapping', () => {
    expect(needsYouNextEntry(entries, null)?.groupKey).toBe('chat:c1')
    expect(needsYouNextEntry(entries, { key: entries[0]!.key, index: 0 })?.groupKey).toBe('chat:c2')
    expect(needsYouNextEntry(entries, { key: entries[2]!.key, index: 2 })?.groupKey).toBe('chat:c1')
  })

  it('goes to the one now at its place after an answer took the last one off', () => {
    const rest = entries.filter((entry) => entry.groupKey !== 'chat:c2')
    expect(needsYouNextEntry(rest, { key: entries[1]!.key, index: 1 })?.groupKey).toBe('chat:c3')
    // Past the end it lands on the last one left.
    expect(needsYouNextEntry(rest, { key: 'gone', index: 9 })?.groupKey).toBe('chat:c3')
  })

  it('has none with nothing waiting, or only the one just shown', () => {
    expect(needsYouNextEntry([], null)).toBeNull()
    const one = entries.slice(0, 1)
    expect(needsYouNextEntry(one, { key: one[0]!.key, index: 0 })).toBeNull()
  })
})
