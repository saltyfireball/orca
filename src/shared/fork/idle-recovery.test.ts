import { describe, expect, it } from 'vitest'
import {
  IDLE_RECOVERY_WAKE_MARKER,
  buildIdleRecoveryWakeMessage,
  decideIdleRecoveryWake,
  idleRecoveryEndingFingerprint,
  isWakePrompt,
  parseIdleRecoveryVerdict,
  tailForIdleRecoveryClassifier,
  type IdleRecoveryWakeFacts
} from './idle-recovery'
import { readIdleRecoverySettings, withIdleRecoveryPaused } from './idle-recovery-settings'
import { forkSettingReadOnlyReason } from './settings-catalog/settings-access'

const FINISHED = { verdict: 'finished', question: '', nextStep: '', wakeAfterSeconds: 0 }

function verdictJson(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    verdict: 'stalled',
    reason: 'offered to run the tests',
    question: '',
    next_step: 'Run the tests you offered to run.',
    wake_after_seconds: 0,
    ...overrides
  })
}

describe('parseIdleRecoveryVerdict', () => {
  it('reads a complete verdict', () => {
    expect(parseIdleRecoveryVerdict(verdictJson({ wake_after_seconds: 90 }), 3600)).toEqual({
      verdict: 'stalled',
      reason: 'offered to run the tests',
      question: '',
      nextStep: 'Run the tests you offered to run.',
      wakeAfterSeconds: 90
    })
  })

  it('reads anything it cannot trust as finished', () => {
    const bad = [
      'not json',
      '[]',
      'null',
      verdictJson({ verdict: 'wake' }),
      verdictJson({ verdict: undefined }),
      verdictJson({ reason: undefined }),
      verdictJson({ question: 7 }),
      verdictJson({ next_step: undefined }),
      verdictJson({ wake_after_seconds: '60' }),
      verdictJson({ wake_after_seconds: undefined })
    ]
    for (const stdout of bad) {
      expect(parseIdleRecoveryVerdict(stdout, 3600)).toMatchObject(FINISHED)
    }
  })

  it('clamps the wait to 0 and the recheck ceiling', () => {
    expect(
      parseIdleRecoveryVerdict(verdictJson({ wake_after_seconds: 99999 }), 3600).wakeAfterSeconds
    ).toBe(3600)
    expect(
      parseIdleRecoveryVerdict(verdictJson({ wake_after_seconds: -5 }), 3600).wakeAfterSeconds
    ).toBe(0)
    expect(
      parseIdleRecoveryVerdict(verdictJson({ wake_after_seconds: 12.6 }), 3600).wakeAfterSeconds
    ).toBe(13)
  })

  it('clips long strings', () => {
    const long = 'x'.repeat(5000)
    const verdict = parseIdleRecoveryVerdict(
      verdictJson({ reason: long, question: long, next_step: long }),
      3600
    )
    expect([verdict.reason.length, verdict.question.length, verdict.nextStep.length]).toEqual([
      500, 2000, 2000
    ])
  })
})

describe('decideIdleRecoveryWake', () => {
  const ok: IdleRecoveryWakeFacts = {
    wakesThisTurn: 0,
    maxWakes: 2,
    requestSource: 'user',
    role: 'standalone',
    workers: 'skip',
    paused: false,
    backgroundPending: false,
    scheduledWake: false,
    coordinatorBusy: false
  }

  it('wakes a user turn and a turn it woke itself, within the budget', () => {
    expect(decideIdleRecoveryWake(ok)).toEqual({ action: 'wake' })
    expect(decideIdleRecoveryWake({ ...ok, requestSource: 'wake', wakesThisTurn: 1 })).toEqual({
      action: 'wake'
    })
  })

  it('never wakes a turn someone else owns, a skipped worker or a spent budget', () => {
    expect(decideIdleRecoveryWake({ ...ok, requestSource: 'orchestration' })).toEqual({
      action: 'never',
      reason: 'request-source'
    })
    expect(decideIdleRecoveryWake({ ...ok, requestSource: 'automation' })).toEqual({
      action: 'never',
      reason: 'request-source'
    })
    expect(decideIdleRecoveryWake({ ...ok, role: 'worker' })).toEqual({
      action: 'never',
      reason: 'worker'
    })
    expect(decideIdleRecoveryWake({ ...ok, role: 'worker', workers: 'include' })).toEqual({
      action: 'wake'
    })
    expect(decideIdleRecoveryWake({ ...ok, wakesThisTurn: 2 })).toEqual({
      action: 'never',
      reason: 'wake-budget'
    })
    expect(decideIdleRecoveryWake({ ...ok, maxWakes: 0 })).toEqual({
      action: 'never',
      reason: 'wake-budget'
    })
  })

  it('holds while paused, while a coordinator has work out, and while work is pending', () => {
    expect(decideIdleRecoveryWake({ ...ok, paused: true })).toEqual({
      action: 'hold',
      reason: 'paused'
    })
    expect(decideIdleRecoveryWake({ ...ok, role: 'coordinator', coordinatorBusy: true })).toEqual({
      action: 'hold',
      reason: 'coordinator-busy'
    })
    expect(decideIdleRecoveryWake({ ...ok, role: 'coordinator' })).toEqual({ action: 'wake' })
    expect(decideIdleRecoveryWake({ ...ok, backgroundPending: true })).toEqual({
      action: 'hold',
      reason: 'background-pending'
    })
    expect(decideIdleRecoveryWake({ ...ok, scheduledWake: true })).toEqual({
      action: 'hold',
      reason: 'scheduled-wake'
    })
  })
})

describe('wake marker', () => {
  it('marks the messages it builds and nothing else', () => {
    expect(IDLE_RECOVERY_WAKE_MARKER).toBe('[idle-recovery: automatic wake]')
    expect(buildIdleRecoveryWakeMessage('  Run the tests.  ')).toBe(
      '[idle-recovery: automatic wake]\nRun the tests.'
    )
    expect(isWakePrompt('\n [idle-recovery: automatic wake]\nRun the tests.')).toBe(true)
    expect(isWakePrompt('Please [idle-recovery: automatic wake]')).toBe(false)
    expect(isWakePrompt(null)).toBe(false)
  })
})

describe('idleRecoveryEndingFingerprint', () => {
  it('is stable per chat and ending, and keeps the chat id apart from the text', () => {
    expect(idleRecoveryEndingFingerprint('chat-1', 'Shall I go on?')).toBe(
      idleRecoveryEndingFingerprint('chat-1', 'Shall I go on?')
    )
    expect(idleRecoveryEndingFingerprint('chat-1', 'Shall I go on?')).toMatch(/^[0-9a-f]{16}$/)
    expect(idleRecoveryEndingFingerprint('chat-1', 'Shall I go on?')).not.toBe(
      idleRecoveryEndingFingerprint('chat-2', 'Shall I go on?')
    )
    expect(idleRecoveryEndingFingerprint('ab', 'c')).not.toBe(
      idleRecoveryEndingFingerprint('a', 'bc')
    )
  })
})

describe('tailForIdleRecoveryClassifier', () => {
  it('keeps the last 8000 characters', () => {
    const tail = tailForIdleRecoveryClassifier(`${'a'.repeat(9000)}END`)
    expect(tail.length).toBe(8000)
    expect(tail.endsWith('END')).toBe(true)
    expect(tailForIdleRecoveryClassifier('short')).toBe('short')
  })
})

describe('idle recovery settings', () => {
  it('ships off, with no command and no notification', () => {
    expect(readIdleRecoverySettings({})).toEqual({
      mode: 'off',
      idleSeconds: 45,
      classifierCommand: null,
      classifierTimeoutSeconds: 30,
      maxWakes: 2,
      recheckMaxMinutes: 60,
      workers: 'skip',
      paused: [],
      notifyDesktop: false,
      notifyWebhookUrl: null,
      notifyCommand: null
    })
  })

  it('drops values out of range and addresses that are not http', () => {
    const settings = readIdleRecoverySettings({
      forkIdleSweepMode: 'always',
      forkIdleSweepIdleSeconds: 1,
      forkIdleSweepMaxWakes: 500,
      forkInboxNotifyWebhookUrl: 'file:///etc/hosts',
      forkIdleSweepPaused: ['a', 7, 'a', '']
    })
    expect(settings.mode).toBe('off')
    expect(settings.idleSeconds).toBe(45)
    expect(settings.maxWakes).toBe(2)
    expect(settings.notifyWebhookUrl).toBeNull()
    expect(settings.paused).toEqual(['a'])
  })

  it('pauses and resumes one chat', () => {
    expect(withIdleRecoveryPaused({ forkIdleSweepPaused: ['a'] }, 'b', true)).toEqual({
      forkIdleSweepPaused: ['a', 'b']
    })
    expect(withIdleRecoveryPaused({ forkIdleSweepPaused: ['a', 'b'] }, 'a', false)).toEqual({
      forkIdleSweepPaused: ['b']
    })
  })

  it('keeps the command and address settings out of CLI writes', () => {
    for (const key of [
      'forkIdleSweepClassifierCommand',
      'forkInboxNotifyCommand',
      'forkInboxNotifyWebhookUrl'
    ]) {
      expect(forkSettingReadOnlyReason(key)).toContain('Settings screen')
    }
    expect(forkSettingReadOnlyReason('forkIdleSweepMode')).toBeNull()
  })
})
