import { describe, expect, it } from 'vitest'
import { inboxItem, NOW } from './decision-inbox-test-kit'
import {
  decisionInboxBadgeText,
  decisionInboxNow,
  decisionInboxSections,
  oldestWaitingChat
} from './decision-inbox-view'

describe('decisionInboxSections', () => {
  it('splits waiting from stalled, each oldest first', () => {
    const sections = decisionInboxSections([
      inboxItem({ chatId: 'new', since: NOW - 1 }),
      inboxItem({ chatId: 'stalled', verdict: 'stalled', since: NOW - 3 }),
      inboxItem({ chatId: 'old', since: NOW - 2 })
    ])
    expect(sections.waiting.map((item) => item.chatId)).toEqual(['old', 'new'])
    expect(sections.stalled.map((item) => item.chatId)).toEqual(['stalled'])
  })

  it('reads nothing as empty', () => {
    expect(decisionInboxSections(null)).toEqual({ waiting: [], stalled: [], paused: [] })
  })

  it('keeps paused chats apart from both counts, oldest first', () => {
    const sections = decisionInboxSections([
      inboxItem({ chatId: 'live' }),
      inboxItem({ chatId: 'paused-new', paused: true, since: NOW - 1 }),
      inboxItem({ chatId: 'paused-old', verdict: 'stalled', paused: true, since: NOW - 5 })
    ])
    expect(sections.waiting.map((item) => item.chatId)).toEqual(['live'])
    expect(sections.stalled).toEqual([])
    expect(sections.paused.map((item) => item.chatId)).toEqual(['paused-old', 'paused-new'])
  })
})

describe('oldestWaitingChat', () => {
  it('skips stalled chats', () => {
    const items = [
      inboxItem({ chatId: 'stalled', verdict: 'stalled', since: NOW - 9 }),
      inboxItem({ chatId: 'waiting', since: NOW - 1 })
    ]
    expect(oldestWaitingChat(items)?.chatId).toBe('waiting')
    expect(oldestWaitingChat([items[0]])).toBeNull()
  })

  it('skips paused chats', () => {
    expect(oldestWaitingChat([inboxItem({ paused: true, since: NOW - 9 })])).toBeNull()
  })
})

describe('decisionInboxBadgeText', () => {
  it('caps the count', () => {
    expect(decisionInboxBadgeText(7)).toBe('7')
    expect(decisionInboxBadgeText(99)).toBe('99')
    expect(decisionInboxBadgeText(100)).toBe('99+')
  })
})

describe('decisionInboxNow', () => {
  it("moves the host's clock by the time since the read, never backwards", () => {
    expect(decisionInboxNow({ now: 1000 }, 50, 80)).toBe(1030)
    expect(decisionInboxNow({ now: 1000 }, 50, 40)).toBe(1000)
  })
})
