// PR babysitter (SLRM-2386): the status line words and the repo list field.
import { describe, expect, it } from 'vitest'
import { translate } from '@/i18n/i18n'
import type { PrBabysitEntry } from '../../../../shared/fork/pr-babysit'
import { prBabysitLineText } from './ForkPrBabysitLine'
import { parsePrBabysitReposText } from './ForkPrBabysitSetting'

const base: PrBabysitEntry = {
  prKey: 'github.com/acme/api#12',
  source: 'repo',
  chatId: 'chat-1',
  rounds: 1,
  phase: 'fixing',
  reason: null,
  detail: '',
  lastEvent: null,
  headSha: null,
  fixSentAt: 1,
  stuckSince: null,
  updatedAt: 1
}

describe('prBabysitLineText', () => {
  it('words each state, and nothing for a stopped pull request', () => {
    expect(prBabysitLineText(base, 3, translate)).toBe(
      'Babysitter: fix 1 of 3 sent, waiting for CI'
    )
    expect(
      prBabysitLineText(
        { ...base, phase: 'green', reason: 'merge-blocked', detail: 'a review is required' },
        3,
        translate
      )
    ).toBe('Babysitter: checks green, not mergeable: a review is required')
    expect(
      prBabysitLineText({ ...base, phase: 'stuck', reason: 'cap', rounds: 3 }, 3, translate)
    ).toBe('Babysitter stopped: CI still failing after 3 fix requests')
    expect(prBabysitLineText({ ...base, phase: 'stopped' }, 3, translate)).toBeNull()
  })
})

describe('parsePrBabysitReposText', () => {
  it('splits on commas and spaces and keeps only repo names', () => {
    expect(parsePrBabysitReposText('Acme/API, acme/web\n*  junk acme/api')).toEqual([
      'acme/api',
      'acme/web',
      '*'
    ])
  })
})
