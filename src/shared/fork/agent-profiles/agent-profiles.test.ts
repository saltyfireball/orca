import { describe, expect, it } from 'vitest'
import {
  forkLaunchEffortChoices,
  forkLaunchModelChoices
} from '../launch-defaults/launch-defaults-choices'
import { importForkAgentDefinition } from './agent-profiles-import'
import { normalizeForkAgentProfiles } from './agent-profiles-normalize'
import { forkAgentProfileHash, resolveForkAgentProfile } from './agent-profiles-resolve'

const claudeModels = forkLaunchModelChoices('claude')
const model = claudeModels.find(
  (choice) => forkLaunchEffortChoices('claude', choice.value).length
)!.value
const otherModel = claudeModels.find((choice) => choice.value !== model)!.value
const effort = forkLaunchEffortChoices('claude', model)[0]!.value

const reviewer = {
  name: 'reviewer',
  agent: 'claude',
  model,
  effort,
  permissionMode: 'ask',
  mcpProfile: 'none',
  whenToUse: 'Read-only review'
}

function resolve(
  profile: object,
  explicit?: Parameters<typeof resolveForkAgentProfile>[0]['explicit'],
  extra: object = {}
) {
  return resolveForkAgentProfile({
    settings: { forkAgentProfiles: [profile], ...extra },
    name: (profile as { name: string }).name,
    explicit
  })
}

describe('resolveForkAgentProfile', () => {
  it('returns the profile fields', () => {
    const result = resolve(reviewer)
    expect(result).toMatchObject({
      ok: true,
      resolved: {
        agent: 'claude',
        model,
        effort,
        permissionMode: 'ask',
        mcpProfile: 'none',
        whenToUse: 'Read-only review',
        notes: []
      }
    })
  })

  it('lets explicit flags override profile fields', () => {
    const result = resolve(reviewer, { model: otherModel, mcpProfile: 'all' })
    expect(result).toMatchObject({ ok: true, resolved: { model: otherModel, mcpProfile: 'all' } })
    // A different model drops the profile's effort: it was chosen for the profile's model.
    expect((result as { resolved: { effort?: string } }).resolved.effort).toBeUndefined()
  })

  it('drops the profile model when --agent changes the agent', () => {
    const result = resolve(reviewer, { agent: 'codex' })
    expect(result).toMatchObject({ ok: true, resolved: { agent: 'codex' } })
    const resolved = (result as { resolved: { model?: string; notes: string[] } }).resolved
    expect(resolved.model).toBeUndefined()
    expect(resolved.notes.join(' ')).toMatch(/replaces the profile's agent/)
  })

  it('does not use a model the agent refuses, and says so', () => {
    const result = resolve({ ...reviewer, effort: 'not-an-effort' })
    const resolved = (result as { resolved: { model?: string; notes: string[] } }).resolved
    expect(resolved.model).toBeUndefined()
    expect(resolved.notes[0]).toMatch(/model was not used/)
    expect((result as { resolved: { effort?: string } }).resolved.effort).toBeUndefined()
  })

  it('refuses an unknown profile', () => {
    expect(resolveForkAgentProfile({ settings: {}, name: 'nope' })).toMatchObject({
      ok: false,
      code: 'unknown_profile'
    })
  })

  it('never widens permission beyond the settings policy', () => {
    const wide = { ...reviewer, permissionMode: 'full-access' }
    // No policy: the cap setting applies, default accept-edits.
    expect(resolve(wide)).toMatchObject({ resolved: { permissionMode: 'accept-edits' } })
    expect(resolve(wide, undefined, { forkAgentProfilePermissionCap: 'auto' })).toMatchObject({
      resolved: { permissionMode: 'auto' }
    })
    // The agent's own policy in Settings > Agents wins over the cap setting.
    expect(
      resolve(wide, undefined, {
        forkAgentProfilePermissionCap: 'full-access',
        agentPermissionOverrides: { claude: 'ask' }
      })
    ).toMatchObject({ resolved: { permissionMode: 'ask' } })
    expect(
      resolve(wide, { permissionMode: 'full-access' }, { agentPermissionDefault: 'ask' })
    ).toMatchObject({ resolved: { permissionMode: 'ask' } })
    const lowered = resolve(wide) as { resolved: { notes: string[] } }
    expect(lowered.resolved.notes[0]).toMatch(/wider than Settings allow/)
  })

  it('holds an imported preamble until it is confirmed, and again after an edit', () => {
    const imported = {
      name: 'imp',
      agent: 'claude',
      preamble: 'Do the thing.',
      imported: { path: '/x/.claude/agents/imp.md' }
    }
    expect(resolve(imported)).toMatchObject({ ok: false, code: 'profile_unconfirmed' })
    const confirmed = {
      ...imported,
      imported: { ...imported.imported, confirmedHash: forkAgentProfileHash('Do the thing.') }
    }
    expect(resolve(confirmed)).toMatchObject({ ok: true, resolved: { preamble: 'Do the thing.' } })
    expect(resolve({ ...confirmed, preamble: 'Do something else.' })).toMatchObject({
      ok: false,
      code: 'profile_unconfirmed'
    })
  })
})

describe('normalizeForkAgentProfiles', () => {
  it('keeps valid entries once and drops junk from a hand-edited file', () => {
    expect(
      normalizeForkAgentProfiles([
        { name: 'a', agent: 'claude', permissionMode: 'bogus' },
        { name: 'a', agent: 'codex' },
        { name: 'bad name', agent: 'claude' },
        { name: 'b' },
        7
      ])
    ).toEqual([{ name: 'a', agent: 'claude' }])
    expect(normalizeForkAgentProfiles('x')).toEqual([])
  })
})

describe('importForkAgentDefinition', () => {
  it('reads a Claude markdown agent: the prompt is the preamble', () => {
    const result = importForkAgentDefinition({
      file: '/p/.claude/agents/code-reviewer.md',
      agent: 'claude',
      source:
        '---\nname: Code Reviewer\ndescription: "Reviews diffs for bugs"\nmodel: sonnet\ntools: Read, Grep\n---\nYou review code.\nBe terse.\n'
    })
    expect(result).toEqual({
      ok: true,
      profile: {
        name: 'code-reviewer',
        agent: 'claude',
        model: 'sonnet',
        preamble: 'You review code.\nBe terse.',
        whenToUse: 'Reviews diffs for bugs',
        imported: { path: '/p/.claude/agents/code-reviewer.md' }
      }
    })
  })

  it('treats model inherit as no model and takes the filename when there is no name', () => {
    const result = importForkAgentDefinition({
      file: 'planner.md',
      agent: 'claude',
      source: '---\nmodel: inherit\n---\nPlan first.'
    })
    expect(result).toMatchObject({ ok: true, profile: { name: 'planner' } })
    expect((result as { profile: { model?: string } }).profile.model).toBeUndefined()
  })

  it('reads a Codex TOML agent with multi-line instructions', () => {
    const result = importForkAgentDefinition({
      file: '/p/.codex/agents/tester.toml',
      agent: 'codex',
      source:
        'name = "tester"\ndescription = "Writes tests"\nmodel = "gpt-x" # note\ndeveloper_instructions = """\nWrite tests.\nRun them.\n"""\n'
    })
    expect(result).toMatchObject({
      ok: true,
      profile: {
        name: 'tester',
        agent: 'codex',
        model: 'gpt-x',
        preamble: 'Write tests.\nRun them.',
        whenToUse: 'Writes tests'
      }
    })
  })
})
