import { describe, expect, it } from 'vitest'
import { agentJournalSubmissionKey } from '../agent-session/journal/agent-session-journal-item-key'
import {
  BOUNDARY_COMPACTION_DEFAULT_IDLE_SECONDS,
  BOUNDARY_COMPACTION_DEFAULT_MAX_WAIT_MINUTES,
  BOUNDARY_COMPACTION_DEFAULT_THRESHOLD_TOKENS,
  FORK_BOUNDARY_COMPACTION_MAX_TYPED,
  boundaryCompactionDueAt,
  boundaryCompactionEnabled,
  boundaryCompactionEndingKey,
  boundaryCompactionJournalRefusal,
  boundaryCompactionRefusalIsSettled,
  boundaryCompactionRestRefusal,
  forkBoundaryCompactionOperationId,
  isForkBoundaryCompactionMessageId,
  normalizeForkBoundaryCompactionTyped,
  readBoundaryCompactionSettings,
  type BoundaryCompactionJournalFacts,
  type BoundaryCompactionRestFacts
} from './boundary-compaction'

const NOW = 1_700_000_000_000
const MINUTE = 60_000
const ON = readBoundaryCompactionSettings({ forkBoundaryCompactMode: 'on' })

function rest(overrides: Partial<BoundaryCompactionRestFacts> = {}): BoundaryCompactionRestFacts {
  return {
    compactable: true,
    awake: true,
    inTurn: false,
    backgroundRunning: false,
    paused: false,
    typed: false,
    idleSince: NOW - 60 * MINUTE,
    lastCallAt: null,
    cacheWindowMs: 5 * MINUTE,
    ...overrides
  }
}

function journal(
  overrides: Partial<BoundaryCompactionJournalFacts> = {}
): BoundaryCompactionJournalFacts {
  return {
    requestItemId: 'request-1',
    commandSinceRequest: false,
    queued: false,
    contextTokens: 150_000,
    measuredAt: NOW - 61 * MINUTE,
    ...overrides
  }
}

describe('readBoundaryCompactionSettings', () => {
  it('is off with the documented defaults when nothing is set', () => {
    expect(readBoundaryCompactionSettings(undefined)).toEqual({
      mode: 'off',
      thresholdTokens: BOUNDARY_COMPACTION_DEFAULT_THRESHOLD_TOKENS,
      idleSeconds: BOUNDARY_COMPACTION_DEFAULT_IDLE_SECONDS,
      preferCold: true,
      maxWaitMinutes: BOUNDARY_COMPACTION_DEFAULT_MAX_WAIT_MINUTES
    })
    expect(boundaryCompactionEnabled(undefined)).toBe(false)
    expect(boundaryCompactionEnabled({ forkBoundaryCompactMode: 'on' })).toBe(true)
  })

  it('keeps valid values and falls back on anything else', () => {
    expect(
      readBoundaryCompactionSettings({
        forkBoundaryCompactMode: 'on',
        forkBoundaryCompactThresholdTokens: 80_000,
        forkBoundaryCompactIdleSeconds: 30,
        forkBoundaryCompactPreferCold: false,
        forkBoundaryCompactMaxWaitMinutes: 45
      })
    ).toEqual({
      mode: 'on',
      thresholdTokens: 80_000,
      idleSeconds: 30,
      preferCold: false,
      maxWaitMinutes: 45
    })
    expect(
      readBoundaryCompactionSettings({
        forkBoundaryCompactMode: 'yes',
        forkBoundaryCompactThresholdTokens: 5,
        forkBoundaryCompactIdleSeconds: 1.5,
        forkBoundaryCompactPreferCold: 'no',
        forkBoundaryCompactMaxWaitMinutes: 0
      })
    ).toEqual(readBoundaryCompactionSettings(undefined))
  })
})

describe('boundaryCompactionDueAt', () => {
  const settings = { idleSeconds: 120, preferCold: true, maxWaitMinutes: 20 }
  const idleSince = NOW

  it('is the idle time alone without prefer cold', () => {
    expect(
      boundaryCompactionDueAt(
        { idleSince, lastCallAt: idleSince, cacheWindowMs: 60 * MINUTE },
        { ...settings, preferCold: false }
      )
    ).toBe(idleSince + 120_000)
  })

  it('waits for the cache to expire, counted from the last provider call', () => {
    expect(
      boundaryCompactionDueAt(
        { idleSince, lastCallAt: idleSince, cacheWindowMs: 5 * MINUTE },
        settings
      )
    ).toBe(idleSince + 5 * MINUTE)
    expect(
      boundaryCompactionDueAt(
        { idleSince, lastCallAt: idleSince + 2 * MINUTE, cacheWindowMs: 5 * MINUTE },
        settings
      )
    ).toBe(idleSince + 7 * MINUTE)
  })

  it('stops waiting on a long cache after the longest wait', () => {
    expect(
      boundaryCompactionDueAt(
        { idleSince, lastCallAt: idleSince, cacheWindowMs: 60 * MINUTE },
        settings
      )
    ).toBe(idleSince + 20 * MINUTE)
  })

  it('never comes before the idle time', () => {
    expect(
      boundaryCompactionDueAt(
        { idleSince, lastCallAt: idleSince - 60 * MINUTE, cacheWindowMs: MINUTE },
        settings
      )
    ).toBe(idleSince + 120_000)
    expect(
      boundaryCompactionDueAt(
        { idleSince, lastCallAt: idleSince, cacheWindowMs: 60 * MINUTE },
        { idleSeconds: 3600, preferCold: true, maxWaitMinutes: 1 }
      )
    ).toBe(idleSince + 3600_000)
  })
})

describe('boundaryCompactionRestRefusal', () => {
  it('lets a chat through that rests, is awake and has an empty message box', () => {
    expect(boundaryCompactionRestRefusal(rest(), ON, NOW)).toBeNull()
  })

  it.each([
    [{ compactable: false }, 'not-compactable'],
    [{ awake: false }, 'asleep'],
    [{ inTurn: true }, 'working'],
    [{ idleSince: null }, 'working'],
    [{ backgroundRunning: true }, 'background-work'],
    [{ paused: true }, 'paused'],
    [{ typed: null }, 'typed-unknown'],
    [{ typed: true }, 'typed-text'],
    [{ idleSince: NOW - 60_000 }, 'not-idle-long-enough'],
    // Rested past the idle time, but the cache is warm until 5 minutes after the last call.
    [{ idleSince: NOW - 4 * MINUTE }, 'not-idle-long-enough'],
    [{ idleSince: NOW - 10 * MINUTE, lastCallAt: NOW - MINUTE }, 'not-idle-long-enough']
  ] as const)('refuses %j as %s', (overrides, reason) => {
    expect(boundaryCompactionRestRefusal(rest(overrides), ON, NOW)).toBe(reason)
  })

  it('compacts a warm chat once the longest wait has passed', () => {
    const facts = rest({ idleSince: NOW - 21 * MINUTE, cacheWindowMs: 60 * MINUTE })
    expect(boundaryCompactionRestRefusal(facts, ON, NOW)).toBeNull()
    expect(boundaryCompactionRestRefusal({ ...facts, idleSince: NOW - 19 * MINUTE }, ON, NOW)).toBe(
      'not-idle-long-enough'
    )
  })
})

describe('boundaryCompactionJournalRefusal', () => {
  it('lets a large measured context through once', () => {
    const facts = journal()
    expect(boundaryCompactionJournalRefusal(facts, ON, undefined)).toBeNull()
    expect(boundaryCompactionJournalRefusal(facts, ON, boundaryCompactionEndingKey(facts))).toBe(
      'already-tried'
    )
    // A later turn of the same request is a new ending.
    expect(
      boundaryCompactionJournalRefusal(
        journal({ measuredAt: NOW }),
        ON,
        boundaryCompactionEndingKey(facts)
      )
    ).toBeNull()
  })

  it.each([
    [{ queued: true }, 'queued-message'],
    [{ requestItemId: null }, 'no-request'],
    [{ commandSinceRequest: true }, 'already-compacted'],
    [{ contextTokens: null }, 'context-unknown'],
    [{ measuredAt: null }, 'context-unknown'],
    [{ contextTokens: 119_999 }, 'below-threshold']
  ] as const)('refuses %j as %s', (overrides, reason) => {
    expect(boundaryCompactionJournalRefusal(journal(overrides), ON, undefined)).toBe(reason)
  })

  it('compacts at the threshold itself', () => {
    expect(
      boundaryCompactionJournalRefusal(journal({ contextTokens: 120_000 }), ON, undefined)
    ).toBeNull()
  })

  it('knows which refusals hold until the next turn', () => {
    expect(boundaryCompactionRefusalIsSettled('below-threshold')).toBe(true)
    expect(boundaryCompactionRefusalIsSettled('already-compacted')).toBe(true)
    expect(boundaryCompactionRefusalIsSettled('queued-message')).toBe(false)
    expect(boundaryCompactionRefusalIsSettled('typed-text')).toBe(false)
  })
})

describe('the transcript mark', () => {
  it('knows the row of a compaction this feature sent, and no other row', () => {
    const operationId = forkBoundaryCompactionOperationId(NOW, 'abc123')
    expect(operationId).toBe('fork-boundary-compact-1700000000000-abc123')
    expect(isForkBoundaryCompactionMessageId(agentJournalSubmissionKey(operationId))).toBe(true)
    expect(isForkBoundaryCompactionMessageId(agentJournalSubmissionKey('some-other-send'))).toBe(
      false
    )
    expect(isForkBoundaryCompactionMessageId(operationId)).toBe(false)
    expect(isForkBoundaryCompactionMessageId('')).toBe(false)
  })
})

describe('normalizeForkBoundaryCompactionTyped', () => {
  it('keeps distinct nonempty strings and drops the rest', () => {
    expect(normalizeForkBoundaryCompactionTyped(['a', 'b', 'a', '', 7, null])).toEqual(['a', 'b'])
    expect(normalizeForkBoundaryCompactionTyped('a')).toEqual([])
    const many = Array.from({ length: FORK_BOUNDARY_COMPACTION_MAX_TYPED + 5 }, (_, i) => `s${i}`)
    expect(normalizeForkBoundaryCompactionTyped(many)).toHaveLength(
      FORK_BOUNDARY_COMPACTION_MAX_TYPED
    )
  })
})
