import { describe, expect, it } from 'vitest'
import {
  buildForkBestOfSpec,
  checkForkBestOfCount,
  FORK_BEST_OF_DEFAULT_NOTE,
  findForkBestOfRun,
  forkBestOfCycle,
  forkBestOfTitle,
  parseForkBestOfAgents,
  parseForkBestOfChecks,
  parseForkBestOfHosts,
  readForkBestOfSettings,
  type ForkBestOfRun
} from './best-of'

describe('best-of settings', () => {
  it('defaults to on, claude on auto, archive, 20 runs and the built-in note', () => {
    expect(readForkBestOfSettings(undefined)).toEqual({
      enabled: true,
      agents: 'claude',
      placement: 'auto',
      loserAction: 'archive',
      history: 20,
      attemptNote: FORK_BEST_OF_DEFAULT_NOTE
    })
  })

  it('reads set values and ignores bad ones', () => {
    const settings = readForkBestOfSettings({
      forkBestOf: false,
      forkBestOfAgents: ' codex ',
      forkBestOfPlacement: '',
      forkBestOfLoserAction: 'nuke',
      forkBestOfHistory: 1000,
      forkBestOfAttemptNote: 'Attempt {{index}}'
    })
    expect(settings).toMatchObject({
      enabled: false,
      agents: 'codex',
      placement: 'auto',
      loserAction: 'archive',
      history: 100,
      attemptNote: 'Attempt {{index}}'
    })
  })
})

describe('best-of parsing', () => {
  it('parses agents with models and efforts', () => {
    expect(parseForkBestOfAgents('claude, codex:gpt-5:high, pi:openai/gpt-5, omp:@worker')).toEqual(
      [
        { agent: 'claude' },
        { agent: 'codex', model: 'gpt-5', effort: 'high' },
        { agent: 'pi', model: 'openai/gpt-5' },
        { agent: 'omp', model: '@worker' }
      ]
    )
  })

  it('refuses malformed agents, shell text and too many', () => {
    expect(() => parseForkBestOfAgents('')).toThrow(/at least one/)
    expect(() => parseForkBestOfAgents('cl aude')).toThrow(/does not name/)
    expect(() => parseForkBestOfAgents('claude:$(rm -rf)')).toThrow(/characters/)
    expect(() => parseForkBestOfAgents('a,b,c,d,e')).toThrow(/At most 4/)
  })

  it('parses hosts and cycles lists', () => {
    expect(parseForkBestOfHosts('auto, here,alpha')).toEqual(['auto', 'here', 'alpha'])
    expect(() => parseForkBestOfHosts('a;b')).toThrow()
    expect([0, 1, 2].map((i) => forkBestOfCycle(['a', 'b'], i))).toEqual(['a', 'b', 'a'])
  })

  it('takes 2 to 4 attempts', () => {
    expect(() => checkForkBestOfCount(1)).toThrow()
    expect(() => checkForkBestOfCount(5)).toThrow()
    expect(() => checkForkBestOfCount(2.5)).toThrow()
    expect(() => checkForkBestOfCount(4)).not.toThrow()
  })

  it('builds each attempt spec from the prompt and the note', () => {
    expect(buildForkBestOfSpec(' Fix it ', 'You are {{index}} of {{count}}', 2, 3)).toBe(
      'Fix it\n\n---\nYou are 2 of 3'
    )
    expect(buildForkBestOfSpec('Fix it', '  ', 1, 2)).toBe('Fix it')
  })

  it('titles a run by its first line', () => {
    expect(forkBestOfTitle('\n  Fix the login\nmore')).toBe('Fix the login')
    expect(forkBestOfTitle('x'.repeat(100))).toHaveLength(80)
  })

  it('reads the Tests and Checks report lines, the last one winning', () => {
    expect(parseForkBestOfChecks(null)).toEqual({ tests: 'unknown', checks: 'unknown' })
    expect(
      parseForkBestOfChecks('Done.\nTests: fail\n- **Tests**: passed (42)\nChecks: not run')
    ).toEqual({ tests: 'pass', checks: 'not-run' })
    expect(parseForkBestOfChecks('checks: FAILED lint')).toEqual({
      tests: 'unknown',
      checks: 'fail'
    })
  })

  it('finds a run by id or unique prefix', () => {
    const run = (id: string): ForkBestOfRun => ({
      id,
      createdAt: 0,
      title: id,
      prompt: id,
      attempts: []
    })
    const runs = [run('abcd1111'), run('abcd2222')]
    expect(findForkBestOfRun(runs, 'abcd2').id).toBe('abcd2222')
    expect(() => findForkBestOfRun(runs, 'abcd')).toThrow(/more than one/)
    expect(() => findForkBestOfRun(runs, 'ab')).toThrow(/No best-of run/)
  })
})
