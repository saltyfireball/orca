import { describe, expect, it } from 'vitest'
import { readForkBotRowClick } from './bot-row-ask-jump'
import { readForkNeedsYouSettings } from './needs-you'

describe('readForkBotRowClick', () => {
  it.each([
    [undefined, 'list'],
    [null, 'list'],
    ['list', 'list'],
    ['item', 'item'],
    ['off', 'off'],
    // A value saved before the choice existed keeps a sensible meaning.
    [true, 'item'],
    [false, 'off'],
    ['junk', 'list'],
    [7, 'list']
  ])('reads %s as %s', (saved, expected) => {
    expect(readForkBotRowClick({ forkBotRowAskJump: saved })).toBe(expected)
  })

  it('reads missing settings as the default', () => {
    expect(readForkBotRowClick(null)).toBe('list')
    expect(readForkBotRowClick({})).toBe('list')
  })
})

describe('readForkNeedsYouSettings', () => {
  it('is on unless switched off', () => {
    expect(readForkNeedsYouSettings(undefined)).toEqual({ enabled: true, quickAnswers: true })
    expect(
      readForkNeedsYouSettings({ forkNeedsYou: false, forkNeedsYouQuickAnswers: false })
    ).toEqual({ enabled: false, quickAnswers: false })
  })
})
