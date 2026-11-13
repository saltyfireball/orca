import { describe, expect, it } from 'vitest'
import {
  FORK_WORKER_CLEANUP_DEFAULT_GRACE_MINUTES,
  forkWorkerCleanupAction,
  forkWorkerCleanupEnabled,
  forkWorkerCleanupGraceMinutes,
  forkWorkerCleanupOnDone,
  forkWorkerCleanupOnMerged,
  pickForkWorkerCleanupSettings
} from './worker-cleanup'

describe('worker cleanup settings', () => {
  it('ships off with the stock defaults for a stranger', () => {
    for (const settings of [undefined, null, {}, 'x']) {
      expect(forkWorkerCleanupEnabled(settings)).toBe(false)
      expect(forkWorkerCleanupGraceMinutes(settings)).toBe(
        FORK_WORKER_CLEANUP_DEFAULT_GRACE_MINUTES
      )
      expect(forkWorkerCleanupAction(settings)).toBe('close')
      expect(forkWorkerCleanupOnDone(settings)).toBe(true)
      expect(forkWorkerCleanupOnMerged(settings)).toBe(false)
    }
    expect(FORK_WORKER_CLEANUP_DEFAULT_GRACE_MINUTES).toBe(5)
  })

  it('reads set values', () => {
    const settings = {
      forkWorkerCleanup: true,
      forkWorkerCleanupGraceMinutes: 30,
      forkWorkerCleanupAction: 'release',
      forkWorkerCleanupOnDone: false,
      forkWorkerCleanupOnMerged: true
    }
    expect(forkWorkerCleanupEnabled(settings)).toBe(true)
    expect(forkWorkerCleanupGraceMinutes(settings)).toBe(30)
    expect(forkWorkerCleanupAction(settings)).toBe('release')
    expect(forkWorkerCleanupOnDone(settings)).toBe(false)
    expect(forkWorkerCleanupOnMerged(settings)).toBe(true)
  })

  it('falls back on bad values', () => {
    for (const minutes of [-1, 1.5, 24 * 60 + 1, Number.NaN, '5']) {
      expect(
        forkWorkerCleanupGraceMinutes({
          forkWorkerCleanupGraceMinutes: minutes
        })
      ).toBe(5)
    }
    expect(forkWorkerCleanupGraceMinutes({ forkWorkerCleanupGraceMinutes: 0 })).toBe(0)
    expect(forkWorkerCleanupAction({ forkWorkerCleanupAction: 'delete' })).toBe('close')
    expect(forkWorkerCleanupEnabled({ forkWorkerCleanup: 'yes' })).toBe(false)
    expect(
      pickForkWorkerCleanupSettings({
        forkWorkerCleanupOnMerged: 1,
        other: true
      })
    ).toEqual({})
  })
})
