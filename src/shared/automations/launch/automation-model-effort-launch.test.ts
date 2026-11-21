import { describe, expect, it } from 'vitest'
import {
  applyAutomationLaunchSetupPatch,
  automationTerminalLaunchInputs
} from './automation-launch-setup'
import { automationLaunchInputs } from './automation-launch-choices'
import { buildAgentStartupPlan } from '../../agent-launch/startup/tui-agent-startup'
import { terminalSessionOptionInputs } from '../../agent-launch/startup/tui-agent-launch-command'
import type { Automation } from '../automation-definition'

const picked = applyAutomationLaunchSetupPatch({
  agentId: 'claude',
  launchSetupPatch: { choices: { model: 'claude-opus-5-5', options: { effort: 'xhigh' } } }
})

describe('automation model and effort', () => {
  it('stores the pick as launch preferences', () => {
    expect(picked.launchPreferences).toEqual({
      model: 'claude-opus-5-5',
      options: { effort: 'xhigh' }
    })
  })

  it('launches a chat with the picked model and effort', () => {
    const inputs = automationLaunchInputs('claude', picked)
    expect(inputs.chatSessionOptions).toMatchObject({ model: 'claude-opus-5-5', effort: 'xhigh' })
  })

  it('launches a terminal with the picked model and effort', () => {
    const inputs = automationTerminalLaunchInputs({
      id: 'a',
      ...picked
    } as unknown as Automation)
    expect(inputs.sessionOptions).toMatchObject({ model: 'claude-opus-5-5' })
  })

  it('lets the picker win over a model and effort in Arguments', () => {
    const inputs = automationLaunchInputs('claude', {
      ...picked,
      agentArgs: '--model sonnet --effort low --dangerously-skip-permissions'
    })
    expect(inputs.chatSessionOptions).toMatchObject({ model: 'claude-opus-5-5', effort: 'xhigh' })
    expect(inputs.sessionOptions).toMatchObject({ model: 'claude-opus-5-5', effort: 'xhigh' })
    expect(inputs.agentArgs).not.toMatch(/--model|--effort/)
    expect(inputs.agentArgs).toContain('--dangerously-skip-permissions')
  })

  it('starts the terminal command on the picked model and effort over the host default Arguments', () => {
    const inputs = terminalSessionOptionInputs({
      agent: 'claude',
      settings: { agentDefaultArgs: { claude: '--model sonnet --effort low' } },
      sessionOptions: { model: 'claude-opus-5-5', effort: 'xhigh' },
      agentArgs: undefined,
      shell: 'posix'
    })
    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt: 'go',
      cmdOverrides: {},
      platform: 'darwin',
      ...inputs
    })
    expect(plan?.launchCommand).toBe("claude '--model' 'claude-opus-5-5' '--effort' 'xhigh' 'go'")
  })
})
