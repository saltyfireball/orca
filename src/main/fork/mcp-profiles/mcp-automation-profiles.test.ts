// BAD-800 proof: `orca automations create --profile nightly` keeps the profile's MCP profile on the
// automation, and a later run (after a restart) launches Claude with only that profile's servers.
// The CLI's own flag handling and create handler call the host's real resolve method and the
// dispatcher's real hook; the run goes through the launcher hook into the real terminal plan.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../../../cli/dispatch/dispatch'
import { applyForkAgentProfile } from '../../../cli/fork/agent-profile-flag'
import { AUTOMATION_HANDLERS } from '../../../cli/automations/automations'
import { RuntimeClient } from '../../../cli/runtime/client'
import { AUTOMATION_RUNTIME_CAPABILITIES } from '../../../shared/automations/automation-runtime-capabilities'
import { AutomationCreate } from '../../../shared/rpc-contract/automations/automation-params'
import { FORK_AGENT_PROFILE_METHODS } from '../../runtime/rpc/methods/fork/fork-agent-profiles'
import { resolveAgentTerminalCreateOptions } from '../../runtime/terminal/launch/runtime-agent-terminal-startup'
import { installForkAgentProfileLaunch } from '../agent-profiles/agent-profile-launch-scope'
import { withForkMcpLaunchScope } from './mcp-launch-scope'
import { forkAutomationMcpLaunch } from './mcp-automation-profiles'
import { installForkMcpProfiles, uninstallForkMcpProfilesForTests } from './mcp-profiles-service'

const settings = {
  forkAgentProfiles: [{ name: 'nightly', agent: 'claude', mcpProfile: 'review-tools' }],
  forkMcpProfiles: [{ name: 'review-tools', mode: 'allow', servers: ['lint'] }] as unknown[]
}

let folder: string
let savedConfigDir: string | undefined

async function install(): Promise<void> {
  await installForkMcpProfiles({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the test settings hold the fields these readers take.
    readSettings: () => settings as never,
    dataFolder: join(folder, 'mcp'),
    chatStateFile: null
  })
}

beforeEach(async () => {
  settings.forkMcpProfiles = [{ name: 'review-tools', mode: 'allow', servers: ['lint'] }]
  folder = mkdtempSync(join(tmpdir(), 'fork-automation-mcp-'))
  savedConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = join(folder, 'claude')
  mkdirSync(process.env.CLAUDE_CONFIG_DIR)
  writeFileSync(
    join(process.env.CLAUDE_CONFIG_DIR, '.claude.json'),
    JSON.stringify({ mcpServers: { lint: { command: 'lint-mcp' }, docs: { command: 'docs-mcp' } } })
  )
  await install()
  installForkAgentProfileLaunch({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the test settings hold the fields these readers take.
    readSettings: () => settings as never,
    claudeRouter: () => undefined
  })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  uninstallForkMcpProfilesForTests()
  if (savedConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = savedConfigDir
  }
  rmSync(folder, { recursive: true, force: true })
  vi.restoreAllMocks()
})

type Saved = { id: string; name: string; agentId: string; creationKey?: string }

/** A host whose resolve, status and dispatcher hook are real; the stock automation write keeps
 *  the fields its own schema parsed. */
function host(): { client: RuntimeClient; saved: Saved[] } {
  const saved: Saved[] = []
  const resolve = FORK_AGENT_PROFILE_METHODS.find(
    (method) => method.name === 'fork.agentProfiles.resolve'
  )!
  const runtime = { requireStore: () => ({ getSettings: () => settings }) }
  const reply = (result: unknown) => ({ id: 'r', ok: true as const, result, _meta: {} })
  const client = new RuntimeClient(join(folder, 'cli'), 60_000, null, null)
  vi.spyOn(client, 'call').mockImplementation((async (method: string, params?: unknown) => {
    if (method === 'fork.agentProfiles.resolve') {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler reads only the store's settings.
      return reply(await resolve.handler(params as never, { runtime } as never))
    }
    if (method === 'status.get') {
      return reply({ capabilities: [...AUTOMATION_RUNTIME_CAPABILITIES] })
    }
    if (method === 'repo.show') {
      return reply({ repo: { id: 'repo-1', path: folder } })
    }
    if (method === 'automation.create') {
      const parsed = AutomationCreate.parse(params)
      const call = { request: { method, params }, params: parsed }
      return reply(
        await withForkMcpLaunchScope(call, async () => {
          const automation = {
            id: `a${saved.length + 1}`,
            name: parsed.name,
            agentId: parsed.agentId,
            ...(parsed.creationKey ? { creationKey: parsed.creationKey } : {})
          }
          saved.push(automation)
          return { automation }
        })
      )
    }
    throw new Error(`unexpected ${method}`)
  }) as never)
  return { client, saved }
}

async function createWithProfile(client: RuntimeClient): Promise<void> {
  const flags = new Map<string, string | boolean>([
    ['profile', 'nightly'],
    ['name', 'Nightly lint'],
    ['prompt', 'Lint the repo.'],
    ['trigger', 'daily'],
    ['repo', 'id:repo-1']
  ])
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler context fields the profile flag and create handler read.
  const ctx = { flags, client, cwd: folder, json: true } as unknown as HandlerContext
  await applyForkAgentProfile('automations create', ctx)
  await AUTOMATION_HANDLERS['automations create']!(ctx)
}

function terminalRun(): Promise<string> {
  return resolveAgentTerminalCreateOptions(
    { id: 'wt_1', path: folder, connectionId: null, repo: null, folderWorkspace: null },
    {
      startupAgent: 'claude',
      launchRuntime: {
        platform: 'darwin',
        pty: { shellOverride: undefined, terminalWindowsWslDistro: null }
      }
    },
    {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the terminal plan reads only getSettings.
      store: { getSettings: () => settings } as never,
      hostIdentity: 'host-1',
      toSessionOptions: () => undefined
    }
  ).then((plan) => plan.command ?? '')
}

describe('automations create --profile with an MCP profile (BAD-800)', () => {
  it('keeps it on the automation and every later run loads only its servers', async () => {
    const { client, saved } = host()
    await createWithProfile(client)
    expect(saved).toHaveLength(1)

    // A restart: the store is read back from its file.
    uninstallForkMcpProfilesForTests()
    await install()
    const command = await forkAutomationMcpLaunch(saved[0]!, terminalRun)
    const file = /'--strict-mcp-config' '--mcp-config' '([^']+)'/.exec(command)?.[1]
    expect(file).toBeDefined()
    expect(JSON.parse(readFileSync(file!, 'utf8'))).toEqual({
      mcpServers: { lint: { command: 'lint-mcp' } }
    })
  })

  it('refuses a run once the MCP profile is deleted, without launching', async () => {
    const { client, saved } = host()
    await createWithProfile(client)
    settings.forkMcpProfiles = []
    const launch = vi.fn(terminalRun)
    await expect(forkAutomationMcpLaunch(saved[0]!, launch)).rejects.toThrow(
      /Automation "Nightly lint" did not run: Unknown MCP profile "review-tools"/
    )
    expect(launch).not.toHaveBeenCalled()
  })

  it('creates nothing on a host that cannot keep the MCP profile', async () => {
    uninstallForkMcpProfilesForTests()
    const { client, saved } = host()
    await expect(createWithProfile(client)).rejects.toThrow(/MCP profiles are not loaded/)
    expect(saved).toHaveLength(0)
  })
})
