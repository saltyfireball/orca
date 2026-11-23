// Fork tests of the bot preamble (BAD-715 "Nothing waits on the owner"). Kept apart from upstream's
// bot-preamble tests, which upstream cut from its suite.
import { describe, expect, it } from 'vitest'
import { buildBotPreamble } from './bot-preamble'

const preambleOf = () =>
  buildBotPreamble({ name: 'Reviewer', agent: 'claude', soul: null, memory: null })

describe('buildBotPreamble (fork)', () => {
  it('merges a green pull request it owns, and says ready to merge only where it may not', () => {
    const preamble = preambleOf()
    expect(preamble).toContain('automations watch-pr <owner/repo#n> --bot <you>')
    expect(preamble).toContain('merge it (`gh pr merge`) when you own the repository')
    expect(preamble).toContain('where you may not merge, say once that it is ready to merge')
  })

  it('does not park work on the owner: decisions go to the delegating bot first, hard gates stay', () => {
    const preamble = preambleOf()
    expect(preamble).toContain('Nothing waits on your owner.')
    expect(preamble).toContain(
      'A decision goes first to the bot or coordinator that gave you the work'
    )
    expect(preamble).toContain('sending to other people (mail or messages), secrets and sign-ins')
    expect(preamble).toContain('You may merge your own pull requests in a repository you own')
    expect(preamble).toContain('a review for anyone else is a comment review')
  })

  it('tells the bot to put owner steps in --steps-file and not to say below or above', () => {
    const preamble = preambleOf()
    expect(preamble).toContain('--steps-file')
    expect(preamble).toContain('never the words below or above about steps')
  })
})
