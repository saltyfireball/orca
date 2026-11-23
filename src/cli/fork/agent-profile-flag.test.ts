import { describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch/dispatch'
import { applyForkAgentProfile } from './agent-profile-flag'
import { COMMAND_SPECS } from '../specs'
import { readForkMcpProfileFlag } from './mcp-profile-flag'
import { readCliAgentLaunch } from '../agents/agent-launch-request'
import { getProjectLaunchChoicesPatch } from '../automations/automation-project-launch-flags'

function context(flags: Record<string, string | boolean>, resolved: Record<string, unknown>) {
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

describe('--profile permission mode, account and preamble (BAD-741)', () => {
  const launch = { lines: ['profile permission: accept-edits', 'profile account: dev'], notes: [] }

  function withLaunch(
    flags: Record<string, string | boolean>,
    summary: Record<string, unknown> | undefined
  ) {
    const call = vi.fn(async () => ({
      result: {
        resolved: { ...resolved, permissionMode: 'accept-edits', account: 'dev' },
        launch: summary
      }
    }))
    const ctx = {
      flags: new Map(Object.entries(flags)),
      client: { call },
      cwd: '/tmp',
      json: false
    } as unknown as HandlerContext
    return { ctx, call }
  }

  it('leaves the preamble to the host on a --task start, says what applies, and names the profile in the request', async () => {
    const { ctx } = withLaunch({ profile: 'reviewer', task: 'task_1' }, launch)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    stderr.mockClear()
    await applyForkAgentProfile('orchestration worker-start', ctx)
    expect(ctx.flags.has('spec')).toBe(false)
    expect(String(stderr.mock.calls[0]?.[0])).toContain('profile permission: accept-edits')
    expect(readForkMcpProfileFlag(ctx.flags)).toEqual({
      forkMcpProfile: 'none',
      forkAgentProfile: 'reviewer'
    })
    ctx.flags.delete('model')
    ctx.flags.delete('effort')
    expect(readCliAgentLaunch(ctx.flags, 'claude', { createsWorktree: false })).toMatchObject({
      forkAgentProfile: 'reviewer'
    })
  })

  it('refuses a host that would drop the mode, account or preamble', async () => {
    const { ctx } = withLaunch({ profile: 'reviewer', task: 'task_1' }, undefined)
    await expect(applyForkAgentProfile('orchestration worker-start', ctx)).rejects.toThrow(
      /cannot apply profile "reviewer"/
    )
  })

  it('asks the home to leave the account to the server on --on', async () => {
    const { ctx, call } = withLaunch({ profile: 'reviewer', spec: 's', on: 'server-a' }, launch)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await applyForkAgentProfile('orchestration worker-start', ctx)
    expect(call.mock.calls[0]).toMatchObject([
      'fork.agentProfiles.resolve',
      { name: 'reviewer', remote: true }
    ])
  })

  it('saves the mode as the automation launch choice and says the account is not used', async () => {
    const { ctx } = withLaunch(
      { profile: 'reviewer', prompt: 'p', provider: 'claude' },
      {
        ...launch,
        notes: []
      }
    )
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    stderr.mockClear()
    await applyForkAgentProfile('automations create', ctx)
    expect(getProjectLaunchChoicesPatch(ctx.flags)?.choices).toMatchObject({
      model: 'm',
      permissionMode: 'accept-edits'
    })
    expect(String(stderr.mock.calls[0]?.[0])).toMatch(/automation runs on the account selected/)
  })
})
