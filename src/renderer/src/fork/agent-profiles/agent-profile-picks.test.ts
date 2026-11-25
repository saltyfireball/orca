// BAD-741 proof for the pickers: a picked profile reaches the new-chat launch inputs and the
// automation draft with its choices, the Settings cap, and the preamble once.
import { describe, expect, it } from 'vitest'
import { agentPickerFreshLaunchInputs } from '../../../../shared/agent-launch/picker/agent-launch-picker'
import type { AutomationDraft } from '@/components/automations/authoring/AutomationEditorDialog'
import { forkAgentProfileLaunchDraft, forkAgentProfilePicks } from './agent-profile-picks'
import { forkAgentProfileAutomationDraft } from './ForkAgentProfileAutomationField'

const settings = {
  forkAgentProfiles: [
    {
      name: 'reviewer',
      agent: 'claude',
      model: 'claude-sonnet-5-5',
      effort: 'high',
      permissionMode: 'full-access',
      preamble: 'You review code.'
    },
    { name: 'imported', agent: 'claude', preamble: 'x', imported: { path: '/a.md' } }
  ]
}

describe('profile pickers', () => {
  it('offer every profile, capped, with an unconfirmed import held back', () => {
    const picks = forkAgentProfilePicks(settings)
    expect(
      picks.map((pick) => [pick.profile.name, pick.permissionMode, pick.needsConfirm])
    ).toEqual([
      ['reviewer', 'accept-edits', false],
      ['imported', undefined, true]
    ])
    expect(forkAgentProfilePicks({})).toEqual([])
  })

  it('start a new chat with the profile model, effort, capped mode and preamble', () => {
    const [pick] = forkAgentProfilePicks(settings)
    const draft = forkAgentProfileLaunchDraft(pick!, 'chat')!
    expect(draft.prompt).toBe('You review code.')
    const inputs = agentPickerFreshLaunchInputs(draft, {
      surface: 'chat',
      executionHostId: undefined
    })
    expect(inputs).toEqual({
      sessionOptions: { model: 'claude-sonnet-5-5', effort: 'high', permissionMode: 'accept-edits' }
    })
  })

  // BAD-800: a UI start cannot carry an MCP limit, so the pick starts nothing instead of a chat
  // with every server; "all" is no limit.
  it('refuse to start a profile whose MCP limit a UI start cannot apply', () => {
    const limited = (mcpProfile: string) =>
      forkAgentProfilePicks({
        forkAgentProfiles: [{ name: 'narrow', agent: 'claude', mcpProfile }]
      })[0]!
    const pick = limited('review-tools')
    expect(pick.mcpLimit).toBe('review-tools')
    expect(forkAgentProfileLaunchDraft(pick, 'chat')).toBeNull()
    expect(forkAgentProfileLaunchDraft(pick, 'terminal')).toBeNull()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the fields a launch pick reads or writes.
    const current = { agentId: 'codex', prompt: 'Triage.' } as AutomationDraft
    expect(forkAgentProfileAutomationDraft(current, pick, true, 'chat')).toBe(current)
    expect(forkAgentProfileLaunchDraft(limited('all'), 'chat')).not.toBeNull()
  })

  it('fill the automation draft and put the preamble in front of the prompt once', () => {
    const [pick] = forkAgentProfilePicks({ ...settings, agentPermissionDefault: 'full-access' })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the fields a launch pick reads or writes.
    const current = { agentId: 'codex', prompt: 'Triage new issues.' } as AutomationDraft
    const next = forkAgentProfileAutomationDraft(current, pick!, true, 'chat')
    expect(next.agentId).toBe('claude')
    expect(next.prompt).toBe('You review code.\n\nTriage new issues.')
    expect(JSON.stringify(next.launchSetupPatch)).toContain('"permissionMode":"full-access"')
    expect(JSON.stringify(next.launchSetupPatch)).toContain('"model":"claude-sonnet-5-5"')
    const again = forkAgentProfileAutomationDraft(next, pick!, true, 'chat')
    expect(again.prompt).toBe(next.prompt)
  })
})
