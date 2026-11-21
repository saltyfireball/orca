import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClient } from '../runtime/client'
import { AUTOMATION_HANDLERS } from './automations'
import { AUTOMATION_LAUNCH_SETUP_RUNTIME_CAPABILITY } from '../../shared/automations/automation-runtime-capabilities'
import { formatAutomationList, formatAutomationShow } from './automation-format'

function host(current: Record<string, unknown> = {}) {
  const writes: { method: string; params: unknown }[] = []
  const meta = { runtimeId: 'runtime-1' }
  const call = vi.fn(async (method: string, params?: unknown) => {
    const reply = (result: unknown) => ({ id: 'r', ok: true as const, result, _meta: meta })
    if (method === 'status.get') {
      return reply({ capabilities: [AUTOMATION_LAUNCH_SETUP_RUNTIME_CAPABILITY] })
    }
    if (method === 'repo.show') {
      return reply({ repo: { id: 'repo-1', path: '/tmp/repo-1' } })
    }
    if (method === 'automation.show') {
      return reply({ automation: { id: 'a1', workspaceMode: 'new_per_run', ...current } })
    }
    if (method === 'automation.create' || method === 'automation.update') {
      writes.push({ method, params })
      return reply({ automation: { id: 'a1' } })
    }
    throw new Error(`unexpected ${method}`)
  })
  const client = new RuntimeClient('/tmp/orca-project-model-cli-test', 60_000, null, null)
  vi.spyOn(client, 'call').mockImplementation(call)
  return { client, writes }
}

const flags = (entries: [string, string][]) =>
  new Map<string, string | boolean>([
    ['name', 'Weekday audit'],
    ['prompt', 'Audit the repo'],
    ['trigger', 'daily'],
    ['provider', 'claude'],
    ['repo', 'id:repo-1'],
    ...entries
  ])

afterEach(() => vi.restoreAllMocks())

describe('orca automations --model and --effort on a project automation', () => {
  it('create sends them as a launch setup change', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { client, writes } = host()
    await AUTOMATION_HANDLERS['automations create']!({
      client,
      cwd: '/tmp',
      flags: flags([
        ['model', 'claude-opus-5-5'],
        ['effort', 'xhigh']
      ]),
      json: true
    })
    expect(writes[0]!.params).toMatchObject({
      agentId: 'claude',
      launchSetupPatch: { choices: { model: 'claude-opus-5-5', options: { effort: 'xhigh' } } }
    })
  })

  it('edit changes them on a project automation, and an empty value goes back to the default', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { client, writes } = host()
    await AUTOMATION_HANDLERS['automations edit']!({
      client,
      cwd: '/tmp',
      flags: new Map<string, string | boolean>([
        ['id', 'a1'],
        ['model', ''],
        ['effort', 'high']
      ]),
      json: true
    })
    expect(writes[0]!.params).toMatchObject({
      updates: { launchSetupPatch: { choices: { model: null, options: { effort: 'high' } } } }
    })
  })

  it('refuses them together with --extra-agent-args', async () => {
    const { client, writes } = host()
    await expect(
      AUTOMATION_HANDLERS['automations create']!({
        client,
        cwd: '/tmp',
        flags: flags([
          ['model', 'opus'],
          ['extra-agent-args', '--effort low']
        ]),
        json: true
      })
    ).rejects.toThrow('--extra-agent-args')
    expect(writes).toHaveLength(0)
  })

  it('list and show print the saved model and effort', () => {
    const automation = {
      id: 'a1',
      name: 'Audit',
      agentId: 'claude',
      enabled: true,
      rrule: 'FREQ=DAILY',
      dtstart: 0,
      nextRunAt: 0,
      workspaceMode: 'new_per_run',
      launchPreferences: { model: 'claude-opus-5-5', options: { effort: 'xhigh' } }
    }
    const shown = formatAutomationShow({ automation } as never)
    expect(shown).toContain('model: claude-opus-5-5')
    expect(shown).toContain('effort: xhigh')
    expect(formatAutomationList({ automations: [automation] } as never)).toContain(
      'model: claude-opus-5-5 · effort xhigh'
    )
  })
})
