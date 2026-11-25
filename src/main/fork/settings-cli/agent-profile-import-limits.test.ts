// BAD-817: `orca profiles import|list|confirm` on the host's own settings update, which refuses a
// field its catalog does not know, and its own list rows.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../../../cli/dispatch/dispatch'
import type { RuntimeClient } from '../../../cli/runtime/client'
import { readForkSettings, updateForkSettings } from './settings-cli-apply'
import { forkAgentProfileListRows } from '../agent-profiles/agent-profiles-service'
import { resolveForkAgentProfile } from '../../../shared/fork/agent-profiles/agent-profiles-resolve'
import { FORK_AGENT_PROFILE_HANDLERS } from '../../../cli/fork/agent-profile-handlers'

let dir = ''
afterEach(async () => {
  vi.restoreAllMocks()
  if (dir) {
    await rm(dir, { recursive: true, force: true })
  }
})

function host() {
  let settings: Record<string, unknown> = {}
  const deps = {
    getSettings: () => settings,
    getDefaults: () => ({}),
    apply: async (update: Record<string, unknown>) => {
      settings = { ...settings, ...update }
    }
  }
  const call = async (method: string, params: Record<string, unknown> = {}) => {
    if (method === 'fork.settings.get') {
      return { ok: true, result: readForkSettings(deps) }
    }
    if (method === 'fork.settings.update') {
      return {
        ok: true,
        result: await updateForkSettings(deps, params as { set: Record<string, unknown> })
      }
    }
    if (method === 'fork.agentProfiles.list') {
      return { ok: true, result: { profiles: forkAgentProfileListRows(settings) } }
    }
    throw new Error(`unexpected ${method}`)
  }
  return { client: { call } as unknown as RuntimeClient, settings: () => settings }
}

async function run(command: string, ctx: Omit<HandlerContext, 'json'>): Promise<string> {
  const lines: string[] = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => lines.push(line))
  await FORK_AGENT_PROFILE_HANDLERS[command]!({ ...ctx, json: false })
  vi.restoreAllMocks()
  return lines.join('\n')
}

describe('profiles import of a read-only reviewer', () => {
  it('says the tools were not kept, lists them, and holds the profile until confirmed', async () => {
    dir = await mkdtemp(join(tmpdir(), 'profile-import-'))
    const agents = join(dir, '.claude', 'agents')
    await mkdir(agents, { recursive: true })
    await writeFile(
      join(agents, 'reviewer.md'),
      '---\nname: reviewer\ntools: Read, Grep, Glob\npermissionMode: plan\n---\n'
    )
    await writeFile(join(agents, 'broken.md'), '---\nname: broken\ntools: [Read\n---\nx')
    const { client, settings } = host()
    const base = { client, cwd: dir }

    const imported = await run('profiles import', {
      ...base,
      flags: new Map([['path', agents]])
    })
    expect(imported).toContain('Imported reviewer.')
    expect(imported).toContain('reviewer does not keep these limits')
    expect(imported).toContain('tools: Read, Grep, Glob')
    expect(imported).toMatch(
      /skipped .*broken\.md: Not imported: its frontmatter is not valid YAML/
    )

    const listed = await run('profiles list', { ...base, flags: new Map() })
    expect(listed).toContain(
      'reviewer: agent claude, permission ask [imported: confirm before use]'
    )
    expect(listed).toContain(
      '  not kept: tools: Read, Grep, Glob; permissionMode: plan (read-only plan mode; the profile uses ask)'
    )

    expect(resolveForkAgentProfile({ settings: settings(), name: 'reviewer' })).toMatchObject({
      ok: false,
      code: 'profile_unconfirmed'
    })
    const confirmed = await run('profiles confirm', {
      ...base,
      flags: new Map([['name', 'reviewer']])
    })
    expect(confirmed).toContain('It runs without these limits of its definition')
    expect(resolveForkAgentProfile({ settings: settings(), name: 'reviewer' })).toMatchObject({
      ok: true,
      resolved: { permissionMode: 'ask' }
    })

    // An edit of the preamble keeps the list and its confirm.
    await run('profiles set', {
      ...base,
      flags: new Map([
        ['name', 'reviewer'],
        ['preamble', 'Review only.']
      ])
    })
    const shown = await run('profiles show', { ...base, flags: new Map([['name', 'reviewer']]) })
    expect(shown).toContain('not kept: tools: Read, Grep, Glob')
    expect(shown).toContain('confirmed: yes')
  })
})
