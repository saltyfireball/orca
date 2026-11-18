// PR babysitter (SLRM-2386): the pure rules.
import { describe, expect, it } from 'vitest'
import {
  decidePrBabysitStep,
  parsePrBabysitTarget,
  prBabysitKey,
  prBabysitMergeBlock,
  prBabysitOverdue,
  prBabysitPlain,
  prBabysitRepoListed,
  readPrBabysitSettings,
  type PrBabysitPrFacts
} from './pr-babysit'

describe('readPrBabysitSettings', () => {
  it('ships off: no repos, no auto-merge, 3 rounds, 120 minutes, repo method', () => {
    expect(readPrBabysitSettings(undefined)).toEqual({
      repos: [],
      maxRounds: 3,
      waitMinutes: 120,
      autoMerge: false,
      mergeMethod: 'repo'
    })
  })

  it('keeps valid values and drops the rest', () => {
    const settings = readPrBabysitSettings({
      forkPrBabysitRepos: ['Acme/API', 'acme/api', 'not a repo', '*', 42, 'ghe.example.com/a/b'],
      forkPrBabysitMaxRounds: 11,
      forkPrBabysitWaitMinutes: 30,
      forkPrBabysitAutoMerge: 'yes',
      forkPrBabysitMergeMethod: 'squash'
    })
    expect(settings.repos).toEqual(['acme/api', '*', 'ghe.example.com/a/b'])
    expect(settings.maxRounds).toBe(3)
    expect(settings.waitMinutes).toBe(30)
    expect(settings.autoMerge).toBe(false)
    expect(settings.mergeMethod).toBe('squash')
  })
})

describe('parsePrBabysitTarget', () => {
  it('reads a URL, owner/repo#n and host/owner/repo#n', () => {
    const url = parsePrBabysitTarget('https://github.com/Acme/api/pull/12/files')
    expect(url && prBabysitKey(url)).toBe('github.com/acme/api#12')
    const short = parsePrBabysitTarget('acme/api#7')
    expect(short && prBabysitKey(short)).toBe('github.com/acme/api#7')
    const ghe = parsePrBabysitTarget('ghe.example.com/acme/api#3')
    expect(ghe && prBabysitKey(ghe)).toBe('ghe.example.com/acme/api#3')
  })

  it('refuses anything else', () => {
    expect(parsePrBabysitTarget('12')).toBeNull()
    expect(parsePrBabysitTarget('http://github.com/a/b/pull/1')).toBeNull()
    expect(parsePrBabysitTarget('acme/api#12; rm -rf /')).toBeNull()
    expect(parsePrBabysitTarget('-w/api#12')).toBeNull()
    expect(parsePrBabysitTarget('--web.example.com/a/b#1')).toBeNull()
  })
})

describe('prBabysitRepoListed', () => {
  it('matches owner/repo, host/owner/repo and *', () => {
    expect(prBabysitRepoListed('github.com/acme/api#1', ['acme/api'])).toBe(true)
    expect(prBabysitRepoListed('github.com/acme/api#1', ['github.com/acme/api'])).toBe(true)
    expect(prBabysitRepoListed('github.com/acme/api#1', ['*'])).toBe(true)
    expect(prBabysitRepoListed('github.com/acme/web#1', ['acme/api'])).toBe(false)
    expect(prBabysitRepoListed('github.com/acme/api#1', [])).toBe(false)
  })
})

describe('decidePrBabysitStep', () => {
  const settings = { maxRounds: 2, autoMerge: false }
  const line = (verdict: 'failure' | 'success', occurrence = 1) => ({
    prKey: 'github.com/a/b#1',
    headSha: 'abcdef1',
    occurrence,
    verdict
  })

  it('sends a fix up to the cap, then stops', () => {
    const entry = { phase: 'watching' as const, rounds: 0, lastEvent: null }
    expect(decidePrBabysitStep(entry, line('failure'), settings)).toEqual({ kind: 'fix', round: 1 })
    expect(decidePrBabysitStep({ ...entry, rounds: 2 }, line('failure'), settings)).toEqual({
      kind: 'stuck',
      reason: 'cap'
    })
  })

  it('never acts twice on one line and ignores stopped, merged and stuck failures', () => {
    expect(
      decidePrBabysitStep(
        { phase: 'fixing', rounds: 1, lastEvent: 'abcdef1:1' },
        line('failure'),
        settings
      )
    ).toEqual({ kind: 'ignore' })
    for (const phase of ['stopped', 'merged'] as const) {
      expect(
        decidePrBabysitStep({ phase, rounds: 0, lastEvent: null }, line('success'), settings)
      ).toEqual({ kind: 'ignore' })
    }
    expect(
      decidePrBabysitStep(
        { phase: 'stuck', rounds: 2, lastEvent: null },
        line('failure', 2),
        settings
      )
    ).toEqual({ kind: 'ignore' })
  })

  it('green merges only with auto-merge on, also after a stop', () => {
    expect(
      decidePrBabysitStep({ phase: 'stuck', rounds: 2, lastEvent: null }, line('success'), settings)
    ).toEqual({ kind: 'green', merge: false })
    expect(
      decidePrBabysitStep({ phase: 'fixing', rounds: 1, lastEvent: null }, line('success'), {
        ...settings,
        autoMerge: true
      })
    ).toEqual({ kind: 'green', merge: true })
  })
})

describe('prBabysitOverdue', () => {
  it('is due only for a fix request older than the wait', () => {
    const settings = { waitMinutes: 10 }
    expect(prBabysitOverdue({ phase: 'fixing', fixSentAt: 0 }, 10 * 60_000, settings)).toBe(true)
    expect(prBabysitOverdue({ phase: 'fixing', fixSentAt: 0 }, 9 * 60_000, settings)).toBe(false)
    expect(prBabysitOverdue({ phase: 'green', fixSentAt: 0 }, 99 * 60_000, settings)).toBe(false)
  })
})

describe('prBabysitMergeBlock', () => {
  const clean: PrBabysitPrFacts = {
    state: 'OPEN',
    isDraft: false,
    headSha: 'ABCDEF1',
    reviewDecision: 'APPROVED',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    checksGreen: [true, true]
  }

  it('allows a clean, approved, all-green pull request on the same head', () => {
    expect(prBabysitMergeBlock(clean, 'abcdef1')).toBeNull()
    expect(prBabysitMergeBlock({ ...clean, reviewDecision: null }, 'abcdef1')).toBeNull()
  })

  it('blocks every unsafe case', () => {
    const cases: [Partial<PrBabysitPrFacts>, string][] = [
      [{ state: 'MERGED' }, 'merged'],
      [{ isDraft: true }, 'draft'],
      [{ headSha: '1234567' }, 'newer commit'],
      [{ reviewDecision: 'CHANGES_REQUESTED' }, 'changes are requested'],
      [{ reviewDecision: 'REVIEW_REQUIRED' }, 'review is required'],
      [{ checksGreen: [true, false] }, 'not every check'],
      [{ checksGreen: [] }, 'not every check'],
      [{ mergeable: 'CONFLICTING' }, 'conflicting'],
      [{ mergeStateStatus: 'BLOCKED' }, 'blocked'],
      [{ mergeStateStatus: 'BEHIND' }, 'behind'],
      [{ mergeStateStatus: 'UNSTABLE' }, 'unstable']
    ]
    for (const [change, words] of cases) {
      expect(prBabysitMergeBlock({ ...clean, ...change }, 'abcdef1')).toContain(words)
    }
  })
})

describe('prBabysitPlain', () => {
  it('drops control and invisible characters and caps the length', () => {
    expect(prBabysitPlain('a\u202Eb\u0007c\nd')).toBe('a b c d')
    expect(prBabysitPlain('x'.repeat(400), 20)).toHaveLength(20)
  })
})
