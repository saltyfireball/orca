import { describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch/dispatch'
import { applyForkAgentProfile } from './agent-profile-flag'
import { COMMAND_SPECS } from '../specs'

function context(flags: Record<string, string | boolean>, resolved: object) {
  const call = vi.fn(async () => ({ result: { resolved } }))
  const ctx = {
    flags: new Map(Object.entries(flags)),
    client: { call },
    cwd: '/tmp',
    json: false
  } as unknown as HandlerContext
  return { ctx, call }
}

const resolved = {
  name: 'reviewer',
  agent: 'claude',
  model: 'm',
  effort: 'e',
  mcpProfile: 'none',
  preamble: 'Be careful.',
  notes: []
}

describe('--profile', () => {
  it('fills the launch flags from the host-resolved profile and prefixes the spec', async () => {
    const { ctx, call } = context({ profile: 'reviewer', spec: 'Review PR 5' }, resolved)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await applyForkAgentProfile('orchestration worker-start', ctx)
    expect(call).toHaveBeenCalledWith('fork.agentProfiles.resolve', {
      name: 'reviewer',
      createsWorktree: false
    })
    expect(Object.fromEntries(ctx.flags)).toMatchObject({
      agent: 'claude',
      model: 'm',
      effort: 'e',
      'mcp-profile': 'none',
      spec: 'Be careful.\n\nReview PR 5'
    })
  })

  it('sends explicit flags to the host and keeps them', async () => {
    const { ctx, call } = context(
      { profile: 'reviewer', model: 'mine', 'mcp-profile': 'all', agent: 'claude' },
      { ...resolved, model: 'mine', mcpProfile: 'all', preamble: undefined }
    )
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await applyForkAgentProfile('agent launch', ctx)
    expect(call).toHaveBeenCalledWith('fork.agentProfiles.resolve', {
      name: 'reviewer',
      agent: 'claude',
      model: 'mine',
      mcpProfile: 'all',
      createsWorktree: false
    })
    expect(ctx.flags.get('model')).toBe('mine')
    expect(ctx.flags.get('mcp-profile')).toBe('all')
  })

  it('leaves commands without --profile alone and rejects a bad name', async () => {
    const { ctx, call } = context({}, resolved)
    await applyForkAgentProfile('agent launch', ctx)
    expect(call).not.toHaveBeenCalled()
    const bad = context({ profile: 'bad name' }, resolved)
    await expect(applyForkAgentProfile('agent launch', bad.ctx)).rejects.toThrow(/profile name/)
  })

  it('is a flag of every launch command and the profiles commands exist', () => {
    for (const path of [
      'agent launch',
      'worktree create',
      'orchestration worker-start',
      'automations create'
    ]) {
      const spec = COMMAND_SPECS.find((entry) => entry.path.join(' ') === path)
      expect(spec?.allowedFlags, path).toContain('profile')
    }
    const paths = COMMAND_SPECS.map((entry) => entry.path.join(' '))
    expect(paths).toContain('profiles list')
    expect(paths).toContain('profiles import')
  })
})
