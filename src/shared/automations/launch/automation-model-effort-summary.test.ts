import { describe, expect, it } from 'vitest'
import {
  automationModelEffort,
  formatAutomationModelEffort
} from './automation-model-effort-summary'

describe('automationModelEffort', () => {
  it('reads a project automation from its launch preferences', () => {
    const choice = automationModelEffort({
      launchPreferences: { model: 'claude-opus-5-5', options: { effort: 'xhigh' } }
    } as never)
    expect(choice).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
    expect(formatAutomationModelEffort(choice)).toBe('claude-opus-5-5 · effort xhigh')
  })

  it('reads a bot automation from its own agent setup, only for runs in a new conversation', () => {
    const agentSetup = {
      agent: 'claude',
      launch: { model: 'claude-opus-5-5', options: { effort: 'max' } }
    }
    expect(automationModelEffort({ bot: { runsIn: 'new', agentSetup } } as never)).toEqual({
      model: 'claude-opus-5-5',
      effort: 'max'
    })
    expect(automationModelEffort({ bot: { runsIn: 'chat', agentSetup } } as never)).toEqual({})
  })

  it('is empty where the agent picks', () => {
    expect(automationModelEffort({} as never)).toEqual({})
    expect(formatAutomationModelEffort({})).toBeUndefined()
  })
})
