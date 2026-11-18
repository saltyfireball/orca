import { describe, expect, it } from 'vitest'
import { formatReviewGuideState, parseReviewGuidePr } from './review-guide-handlers'

describe('parseReviewGuidePr', () => {
  it('takes a number, #number or a pull request URL', () => {
    expect(parseReviewGuidePr('42')).toEqual({ pr: 42 })
    expect(parseReviewGuidePr('#42')).toEqual({ pr: 42 })
    expect(parseReviewGuidePr('https://github.com/Owner/Repo/pull/42/files')).toEqual({
      pr: 42,
      prRepo: { host: 'github.com', owner: 'Owner', repo: 'Repo' }
    })
  })

  it('refuses anything else', () => {
    for (const bad of [undefined, '', '0', '-1', 'abc', 'https://github.com/o/r/issues/4']) {
      expect(() => parseReviewGuidePr(bad)).toThrow('Name a pull request')
    }
  })
})

describe('formatReviewGuideState', () => {
  it('says how to write a guide when there is none, and what a running or failed write is doing', () => {
    expect(formatReviewGuideState({ enabled: true, guide: null, job: null, stale: null }, 4)).toBe(
      '#4 has no review guide yet. `orca review-guide write 4` writes one.'
    )
    expect(
      formatReviewGuideState(
        { enabled: true, guide: null, job: { state: 'failed', error: 'boom', at: 1 }, stale: null },
        4
      )
    ).toBe('Writing the guide for #4 failed: boom')
    expect(
      formatReviewGuideState({ enabled: false, guide: null, job: null, stale: null }, 4)
    ).toContain('Review guides are off')
  })
})
