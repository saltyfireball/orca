// PR babysitter (SLRM-2386): the saved state reads back only what this build wrote.
import { describe, expect, it } from 'vitest'
import { emptyPrBabysitState, parsePrBabysitState, prunePrBabysitState } from './pr-babysit-state'

describe('PR babysitter state', () => {
  it('reads an empty state from junk', () => {
    expect(parsePrBabysitState('not json')).toEqual(emptyPrBabysitState())
    expect(parsePrBabysitState('{"entries": 3}')).toEqual(emptyPrBabysitState())
  })

  it('keeps valid rows, drops bad keys and phases, and cleans the detail', () => {
    const state = parsePrBabysitState(
      JSON.stringify({
        entries: {
          'github.com/acme/api#12': {
            phase: 'stuck',
            reason: 'merge-failed',
            detail: 'bad\u0007 text',
            rounds: 2,
            source: 'cli',
            chatId: 'chat-1',
            updatedAt: 5
          },
          'not a key': { phase: 'stuck', updatedAt: 5 },
          'github.com/acme/web#1': { phase: 'hacked', updatedAt: 5 }
        }
      })
    )
    expect(Object.keys(state.entries)).toEqual(['github.com/acme/api#12'])
    expect(state.entries['github.com/acme/api#12']).toMatchObject({
      phase: 'stuck',
      reason: 'merge-failed',
      detail: 'bad text',
      rounds: 2,
      source: 'cli'
    })
  })

  it('prunes merged rows after 2 days and every row after 30 idle days', () => {
    const day = 24 * 60 * 60_000
    const state = parsePrBabysitState(
      JSON.stringify({
        entries: {
          'github.com/a/b#1': { phase: 'merged', updatedAt: 0 },
          'github.com/a/b#2': { phase: 'fixing', updatedAt: 0 },
          'github.com/a/b#3': { phase: 'fixing', updatedAt: 0 }
        }
      })
    )
    state.entries['github.com/a/b#3']!.updatedAt = 29 * day
    prunePrBabysitState(state, 31 * day)
    expect(Object.keys(state.entries)).toEqual(['github.com/a/b#3'])
  })
})
