import { describe, expect, it } from 'vitest'
import {
  forkReviewGateOf,
  parseReviewVerdict,
  readReviewerGateSettings,
  reviewCommandLine,
  reviewPrompt,
  reviewerAgentFor
} from './reviewer-gate'

describe('reviewer gate pure parts', () => {
  it('reads the last verdict line and ignores the prompt echoed on one line', () => {
    expect(parseReviewVerdict('x\nVERDICT: FINDINGS 3\n')).toEqual({ kind: 'findings', count: 3 })
    expect(parseReviewVerdict('VERDICT: FINDINGS 3\nlater\nVERDICT: CLEAN')).toEqual({
      kind: 'clean'
    })
    expect(parseReviewVerdict(reviewPrompt({ headSha: 'abcdef1', focus: 'perf' }))).toEqual({
      kind: 'unreadable'
    })
    expect(parseReviewVerdict('VERDICT: FINDINGS')).toEqual({ kind: 'findings', count: 1 })
  })

  it('picks the other provider than the worker', () => {
    expect(reviewerAgentFor('claude', null)).toBe('codex')
    expect(reviewerAgentFor('codex', null)).toBe('claude')
    expect(reviewerAgentFor('gemini', null)).toBe('codex')
    expect(reviewerAgentFor('codex', 'codex')).toBe('codex')
  })

  it('builds one exec line with the prompt as a single quoted word', () => {
    const prompt = reviewPrompt({ headSha: 'abcdef1', focus: 'security' })
    expect(prompt).not.toMatch(/['"`$]/u)
    const line = reviewCommandLine({
      template: 'codex exec {model} {prompt}',
      prompt,
      model: 'm1',
      platform: 'linux'
    })
    expect(line.startsWith("exec codex exec --model m1 '")).toBe(true)
    expect(() => reviewPrompt({ headSha: 'x; rm', focus: 'perf' })).toThrow()
  })

  it('asks for a review only when told to, and keeps defaults', () => {
    expect(forkReviewGateOf({})).toBeNull()
    expect(forkReviewGateOf({ forkReview: true, forkReviewFocus: 'perf' })).toEqual({
      focus: 'perf',
      agent: null,
      maxRounds: null
    })
    const settings = readReviewerGateSettings({})
    expect(settings).toMatchObject({ enabled: true, allTasks: false, maxRounds: 2 })
    expect(readReviewerGateSettings({ forkReviewerGateModel: 'a b; rm' }).model).toBe('')
  })
})
