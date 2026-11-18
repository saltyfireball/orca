import { describe, expect, it } from 'vitest'
import type { AgentSessionRestartActivity } from '../agent-session/lifecycle/stopping/agent-session-restart-activity'
import {
  chatRunsAutomation,
  decideUnattendedResume,
  pickUnattendedResumeSettings,
  readUnattendedResumeSettings,
  UNATTENDED_RESUME_DEFAULT_MAX_TRIES,
  type UnattendedResumeFacts
} from './unattended-resume'

const WORKING: AgentSessionRestartActivity = { state: 'working', prompts: [], tasks: [] }

function facts(overrides: Partial<UnattendedResumeFacts> = {}): UnattendedResumeFacts {
  return {
    settings: readUnattendedResumeSettings({}),
    kind: 'worker',
    activity: WORKING,
    triesUsed: 0,
    ...overrides
  }
}

describe('readUnattendedResumeSettings', () => {
  it('is on with 3 tries when unset', () => {
    expect(readUnattendedResumeSettings(undefined)).toEqual({
      enabled: true,
      maxTries: 3,
      interactive: false
    })
    expect(UNATTENDED_RESUME_DEFAULT_MAX_TRIES).toBe(3)
  })

  it('turns off only on an explicit false', () => {
    expect(readUnattendedResumeSettings({ forkUnattendedResume: false }).enabled).toBe(false)
    expect(readUnattendedResumeSettings({ forkUnattendedResume: 'no' }).enabled).toBe(true)
  })

  it('takes a whole number of tries in range and falls back otherwise', () => {
    expect(readUnattendedResumeSettings({ forkUnattendedResumeMaxTries: 5 }).maxTries).toBe(5)
    for (const bad of [0, -1, 2.5, 21, '4', null]) {
      expect(readUnattendedResumeSettings({ forkUnattendedResumeMaxTries: bad }).maxTries).toBe(3)
    }
  })
})

describe('interactive resume setting (SLRM-2411)', () => {
  it('follows chat survive while unset', () => {
    expect(readUnattendedResumeSettings({ forkChatSurvive: true }).interactive).toBe(true)
    expect(readUnattendedResumeSettings({ forkChatSurvive: false }).interactive).toBe(false)
    expect(readUnattendedResumeSettings({}).interactive).toBe(false)
    expect(readUnattendedResumeSettings({ forkChatSurvive: 'yes' }).interactive).toBe(false)
  })

  it('takes an explicit true or false over chat survive', () => {
    expect(
      readUnattendedResumeSettings({
        forkChatSurvive: true,
        forkUnattendedResumeInteractive: false
      }).interactive
    ).toBe(false)
    expect(
      readUnattendedResumeSettings({ forkUnattendedResumeInteractive: true }).interactive
    ).toBe(true)
    expect(
      readUnattendedResumeSettings({ forkChatSurvive: true, forkUnattendedResumeInteractive: 1 })
        .interactive
    ).toBe(true)
  })
})

describe('pickUnattendedResumeSettings', () => {
  it('takes its keys off a whole settings object and nothing else', () => {
    expect(
      pickUnattendedResumeSettings({
        theme: 'dark',
        forkUnattendedResume: false,
        forkChatSurvive: true
      })
    ).toEqual({
      forkUnattendedResume: false,
      forkUnattendedResumeMaxTries: undefined,
      forkUnattendedResumeInteractive: undefined,
      forkChatSurvive: true
    })
    expect(pickUnattendedResumeSettings(null)).toBeNull()
    expect(pickUnattendedResumeSettings('x')).toBeNull()
  })
})

describe('decideUnattendedResume', () => {
  it('resumes a worker and an automation run that were working', () => {
    expect(decideUnattendedResume(facts())).toEqual({ action: 'resume' })
    expect(decideUnattendedResume(facts({ kind: 'automation' }))).toEqual({ action: 'resume' })
  })

  it('leaves interactive chats to the stock offer', () => {
    expect(decideUnattendedResume(facts({ kind: null }))).toEqual({
      action: 'skip',
      reason: 'interactive'
    })
  })

  it('continues an interactive chat the agent was working on when the setting is on', () => {
    const on = readUnattendedResumeSettings({ forkUnattendedResumeInteractive: true })
    expect(decideUnattendedResume(facts({ kind: null, settings: on }))).toEqual({
      action: 'resume'
    })
    const survive = readUnattendedResumeSettings({ forkChatSurvive: true })
    expect(decideUnattendedResume(facts({ kind: null, settings: survive }))).toEqual({
      action: 'resume'
    })
  })

  it('leaves an interactive turn that was not working, asked, or used its tries', () => {
    const on = readUnattendedResumeSettings({ forkUnattendedResumeInteractive: true })
    const cases: [AgentSessionRestartActivity | undefined, string][] = [
      [{ state: 'waiting', prompts: [], tasks: [] }, 'awaiting-person'],
      [{ state: 'blocked', prompts: [], tasks: [] }, 'awaiting-person'],
      [{ state: 'done', prompts: [], tasks: [{ kind: 'agent', label: 'x' }] }, 'awaiting-person'],
      [
        { state: 'working', prompts: [{ kind: 'question', label: 'Which?' }], tasks: [] },
        'awaiting-person'
      ],
      [undefined, 'activity-unknown']
    ]
    for (const [activity, reason] of cases) {
      expect(decideUnattendedResume(facts({ kind: null, settings: on, activity }))).toEqual({
        action: 'skip',
        reason
      })
    }
    expect(decideUnattendedResume(facts({ kind: null, settings: on, triesUsed: 3 }))).toEqual({
      action: 'skip',
      reason: 'tries-used'
    })
    const off = readUnattendedResumeSettings({
      forkUnattendedResume: false,
      forkUnattendedResumeInteractive: true
    })
    expect(decideUnattendedResume(facts({ kind: null, settings: off }))).toEqual({
      action: 'skip',
      reason: 'disabled'
    })
  })

  it('does nothing when switched off', () => {
    expect(
      decideUnattendedResume(
        facts({ settings: readUnattendedResumeSettings({ forkUnattendedResume: false }) })
      )
    ).toEqual({ action: 'skip', reason: 'disabled' })
  })

  it('never resumes a turn that was waiting on an approval or a question', () => {
    const approval: AgentSessionRestartActivity = {
      state: 'working',
      prompts: [{ kind: 'approval', label: 'Run rm' }],
      tasks: []
    }
    const question: AgentSessionRestartActivity = {
      state: 'working',
      prompts: [{ kind: 'question', label: 'Which branch?' }],
      tasks: []
    }
    const blocked: AgentSessionRestartActivity = { state: 'blocked', prompts: [], tasks: [] }
    for (const activity of [approval, question, blocked]) {
      expect(decideUnattendedResume(facts({ activity }))).toEqual({
        action: 'skip',
        reason: 'awaiting-person'
      })
    }
  })

  it('does not guess when the stop-time capture is missing', () => {
    expect(decideUnattendedResume(facts({ activity: undefined }))).toEqual({
      action: 'skip',
      reason: 'activity-unknown'
    })
  })

  it('stops at the try cap', () => {
    expect(decideUnattendedResume(facts({ triesUsed: 2 }))).toEqual({ action: 'resume' })
    expect(decideUnattendedResume(facts({ triesUsed: 3 }))).toEqual({
      action: 'skip',
      reason: 'tries-used'
    })
    const one = readUnattendedResumeSettings({ forkUnattendedResumeMaxTries: 1 })
    expect(decideUnattendedResume(facts({ settings: one, triesUsed: 1 }))).toEqual({
      action: 'skip',
      reason: 'tries-used'
    })
  })
})

describe('chatRunsAutomation', () => {
  const run = (overrides: Partial<Parameters<typeof chatRunsAutomation>[2][number]> = {}) => ({
    chatSessionId: 'chat-1',
    status: 'dispatched',
    createdAt: 100,
    dispatchedAt: 110,
    ...overrides
  })

  it('is true when the newest run before the cut is open or was failed by it', () => {
    expect(chatRunsAutomation('chat-1', 200, [run()])).toBe(true)
    expect(chatRunsAutomation('chat-1', 200, [run({ status: 'dispatch_failed' })])).toBe(true)
  })

  it('is false for a chat whose last run completed', () => {
    expect(
      chatRunsAutomation('chat-1', 200, [
        run({ status: 'dispatch_failed', dispatchedAt: 50 }),
        run({ status: 'completed', dispatchedAt: 150 })
      ])
    ).toBe(false)
  })

  it('ignores other chats and runs started after the cut', () => {
    expect(chatRunsAutomation('chat-1', 200, [run({ chatSessionId: 'chat-2' })])).toBe(false)
    expect(chatRunsAutomation('chat-1', 200, [run({ dispatchedAt: 300 })])).toBe(false)
    expect(chatRunsAutomation('chat-1', 200, [])).toBe(false)
  })
})
