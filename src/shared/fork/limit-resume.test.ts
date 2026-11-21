import { describe, expect, it } from 'vitest'
import {
  LIMIT_RESUME_BACKOFF_CAP_MS,
  limitResumeAt,
  limitResumeNativeContinueOn,
  limitResumeWatchesDrafts,
  normalizeLimitResumeEntries,
  readLimitResumeSettings
} from './limit-resume'

describe('readLimitResumeSettings', () => {
  it('is on with sane defaults when unset', () => {
    expect(readLimitResumeSettings(undefined)).toEqual({
      enabled: true,
      terminals: true,
      maxTries: 5,
      holdWhileTyping: true,
      holdMaxMinutes: 15,
      delaySeconds: 60,
      backoffMinutes: 30,
      message: 'continue',
      codexSwitchPrompt: 'dismiss'
    })
  })

  it('refuses out-of-range numbers and a message with control characters', () => {
    const read = readLimitResumeSettings({
      forkLimitResumeMaxTries: 0,
      forkLimitResumeBackoffMinutes: 1,
      forkLimitResumeMessage: 'go on\n/exit'
    })
    expect(read.maxTries).toBe(5)
    expect(read.backoffMinutes).toBe(30)
    expect(read.message).toBe('continue')
    expect(readLimitResumeSettings({ forkLimitResumeMessage: ' keep going ' }).message).toBe(
      'keep going'
    )
  })
})

describe('native continue and drafts', () => {
  it('turns the stock continue on unless the feature is off and the stock toggle is too', () => {
    expect(limitResumeNativeContinueOn({})).toBe(true)
    expect(limitResumeNativeContinueOn({ forkLimitResume: false })).toBe(false)
    expect(
      limitResumeNativeContinueOn({
        forkLimitResume: false,
        nativeChatAutoContinueAfterUsageLimit: true
      })
    ).toBe(true)
  })

  it('watches drafts only while on and holding for them', () => {
    expect(limitResumeWatchesDrafts({})).toBe(true)
    expect(limitResumeWatchesDrafts({ forkLimitResumeHoldWhileTyping: false })).toBe(false)
    expect(limitResumeWatchesDrafts(null)).toBe(true)
  })
})

describe('limitResumeAt', () => {
  const settings = { delaySeconds: 60, backoffMinutes: 30 }
  it('waits for the reset plus the delay, never before the stop', () => {
    expect(limitResumeAt({ resetsAt: 10_000_000, detectedAt: 0, tries: 0 }, settings)).toBe(
      10_060_000
    )
    expect(limitResumeAt({ resetsAt: 5, detectedAt: 1000, tries: 0 }, settings)).toBe(61_000)
  })

  it('doubles the backoff per try up to the cap', () => {
    expect(limitResumeAt({ resetsAt: null, detectedAt: 0, tries: 1 }, settings)).toBe(3_600_000)
    expect(limitResumeAt({ resetsAt: null, detectedAt: 0, tries: 9 }, settings)).toBe(
      LIMIT_RESUME_BACKOFF_CAP_MS
    )
  })
})

describe('normalizeLimitResumeEntries', () => {
  it('keeps well-formed entries and drops the rest', () => {
    const good = {
      id: 'a:1',
      kind: 'terminal',
      paneKey: 'a:1',
      worktreeId: 'wt',
      agent: 'codex',
      title: 't',
      resetsAt: null,
      resumeAt: 5,
      tries: 1,
      maxTries: 5,
      state: 'parked',
      line: 'x'
    }
    expect(normalizeLimitResumeEntries([good, { id: 'b' }, null, 'x'])).toEqual([good])
    expect(normalizeLimitResumeEntries('nope')).toEqual([])
  })
})
