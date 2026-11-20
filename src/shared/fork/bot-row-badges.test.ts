import { describe, expect, it } from 'vitest'
import {
  forkBotRowBadgesEnabled,
  forkBotRowColor,
  forkBotRowColorsWith,
  forkBotRowColorStyle,
  forkBotRowCounts,
  forkBotRowState,
  normalizeForkBotRowColor
} from './bot-row-badges'

const NONE = {
  rowsAsking: 0,
  rowsWorking: 0,
  workerPermission: 0,
  workerWorking: 0,
  published: null,
  listedItems: null,
  homeWorking: false
}

describe('forkBotRowCounts', () => {
  it('counts nothing for a quiet bot', () => {
    expect(forkBotRowCounts(NONE)).toEqual({ needsYou: 0, working: 0 })
  })

  it('adds asking rows, worker permissions and listed items when nothing publishes a count', () => {
    expect(
      forkBotRowCounts({ ...NONE, rowsAsking: 1, workerPermission: 2, listedItems: 3 }).needsYou
    ).toBe(6)
  })

  it('takes the published count in place of its own parts, as the row line does', () => {
    expect(
      forkBotRowCounts({ ...NONE, rowsAsking: 1, listedItems: 4, published: 2 }).needsYou
    ).toBe(2)
  })

  it('counts working rows and workers, and a bare working home as one', () => {
    expect(forkBotRowCounts({ ...NONE, rowsWorking: 2, workerWorking: 1 }).working).toBe(3)
    expect(forkBotRowCounts({ ...NONE, homeWorking: true }).working).toBe(1)
    expect(forkBotRowCounts({ ...NONE, rowsWorking: 2, homeWorking: true }).working).toBe(2)
  })
})

describe('forkBotRowState', () => {
  const base = { offline: false, paused: false, stopped: false }
  const cases = [
    ['idle with nothing going on', base, { needsYou: 0, working: 0 }, 'idle'],
    ['working', base, { needsYou: 0, working: 3 }, 'working'],
    ['needs you beats working', base, { needsYou: 1, working: 3 }, 'needsYou'],
    [
      'stopped on a usage limit is not idle',
      { ...base, stopped: true },
      { needsYou: 0, working: 0 },
      'stopped'
    ],
    [
      'needs you beats stopped',
      { ...base, stopped: true },
      { needsYou: 1, working: 0 },
      'needsYou'
    ],
    ['paused beats needs you', { ...base, paused: true }, { needsYou: 1, working: 0 }, 'paused'],
    [
      'offline beats paused',
      { ...base, offline: true, paused: true },
      { needsYou: 0, working: 0 },
      'offline'
    ]
  ] as const
  it.each(cases)('%s', (_name, flags, counts, expected) => {
    expect(forkBotRowState({ ...flags, counts })).toBe(expected)
  })
})

describe('forkBotRowColor', () => {
  it('reads a bot by its host and id, and nothing when unset', () => {
    const settings = { forkBotRowColors: { 'local/a': '#3B82F6' } }
    expect(forkBotRowColor(settings, 'local/a')).toBe('#3b82f6')
    expect(forkBotRowColor(settings, 'local/b')).toBeNull()
    expect(forkBotRowColor({}, 'local/a')).toBeNull()
    expect(forkBotRowColor(settings, 'constructor')).toBeNull()
  })

  it('ignores a stored value that is not a hex color', () => {
    expect(forkBotRowColor({ forkBotRowColors: { 'local/a': 'url(x)' } }, 'local/a')).toBeNull()
  })

  it('expands a short hex and rejects the rest', () => {
    expect(normalizeForkBotRowColor('#abc')).toBe('#aabbcc')
    expect(normalizeForkBotRowColor('red')).toBeNull()
    expect(normalizeForkBotRowColor(7)).toBeNull()
  })

  it('sets and clears one bot without touching the others', () => {
    const set = forkBotRowColorsWith({ 'local/b': '#111111' }, 'local/a', '#ef4444')
    expect(set).toEqual({ 'local/b': '#111111', 'local/a': '#ef4444' })
    expect(forkBotRowColorsWith(set, 'local/a', null)).toEqual({ 'local/b': '#111111' })
  })

  it('paints an edge bar and a faint wash of the color', () => {
    expect(forkBotRowColorStyle('#ef4444')).toEqual({
      boxShadow: 'inset 2px 0 0 #ef4444',
      backgroundColor: 'color-mix(in srgb, #ef4444 8%, transparent)'
    })
  })
})

describe('forkBotRowBadgesEnabled', () => {
  it('is on unless set false', () => {
    expect(forkBotRowBadgesEnabled(undefined)).toBe(true)
    expect(forkBotRowBadgesEnabled({})).toBe(true)
    expect(forkBotRowBadgesEnabled({ forkBotRowBadges: false })).toBe(false)
  })
})
