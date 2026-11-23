// BAD-687's first criterion in one test: `orca orchestration worker-start --profile reviewer`
// launches with the profile's agent, model, effort, MCP profile and permission mode, for a
// terminal worker and for a chat worker. The CLI's own flag handling calls the host's real resolve
// method; the request it builds then reaches the real terminal plan and chat creation hooks.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../../../cli/dispatch/dispatch'
import { applyForkAgentProfile } from '../../../cli/fork/agent-profile-flag'
import { readForkMcpProfileFlag } from '../../../cli/fork/mcp-profile-flag'
import { FORK_AGENT_PROFILE_METHODS } from '../../runtime/rpc/methods/fork/fork-agent-profiles'
import { resolveAgentTerminalCreateOptions } from '../../runtime/terminal/launch/runtime-agent-terminal-startup'
import { withForkMcpLaunchScope } from '../mcp-profiles/mcp-launch-scope'
import {
  forkMcpChat,
  installForkMcpProfiles,
  uninstallForkMcpProfilesForTests
} from '../mcp-profiles/mcp-profiles-service'
import { installForkAgentProfileLaunch } from './agent-profile-launch-scope'

const createdChats: { options?: Record<string, string> }[] = []
vi.mock('../../native-chat/agent-session-wire/acquisition/structured-agent-session-create', () => ({
  createStructuredAgentSession: (_ctx: unknown, _caller: unknown, params: never) => {
    createdChats.push(params)
    return Promise.resolve({ ok: true })
  }
}))
const { structuredAgentSessionEntryDelegates } =
  await import('../../native-chat/agent-session-wire/acquisition/structured-agent-session-entry-delegates')

const settings = {
  agentPermissionDefault: 'own',
  forkAgentProfilePermissionCap: 'accept-edits',
  forkAgentProfiles: [
    {
      name: 'reviewer',
      agent: 'claude',
      model: 'sonnet',
      effort: 'high',
      permissionMode: 'accept-edits',
      mcpProfile: 'review-tools',
      note: 'Read-only review of a diff.'
    }
  ],
  forkMcpProfiles: [{ name: 'review-tools', mode: 'allow', servers: ['lint'] }]
}

let folder: string
let savedConfigDir: string | undefined

beforeEach(async () => {
  createdChats.length = 0
  folder = mkdtempSync(join(tmpdir(), 'fork-profile-criterion-'))
  savedConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = join(folder, 'claude')
  mkdirSync(process.env.CLAUDE_CONFIG_DIR)
  writeFileSync(
    join(process.env.CLAUDE_CONFIG_DIR, '.claude.json'),
    JSON.stringify({ mcpServers: { lint: { command: 'lint-mcp' }, docs: { command: 'docs-mcp' } } })
  )
  await installForkMcpProfiles({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the test settings hold the fields these readers take.
    readSettings: () => settings as never,
    dataFolder: join(folder, 'mcp'),
    chatStateFile: null
  })
  installForkAgentProfileLaunch({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the test settings hold the fields these readers take.
    readSettings: () => settings as never,
    claudeRouter: () => undefined
  })
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

/** What `orca orchestration worker-start --profile reviewer --spec ...` sends the host. */
async function workerStartRequest(): Promise<Record<string, unknown>> {
  const resolve = FORK_AGENT_PROFILE_METHODS.find(
    (method) => method.name === 'fork.agentProfiles.resolve'
  )!
  const runtime = { requireStore: () => ({ getSettings: () => settings }) }
  const flags = new Map<string, string | boolean>([
    ['profile', 'reviewer'],
    ['spec', 'Review the parser.']
  ])
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler context fields the profile flag reads.
  const ctx = {
    flags,
    cwd: folder,
    json: false,
    client: {
      call: async (_method: string, params: unknown) => ({
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler reads only the store's settings.
        result: await resolve.handler(params as never, { runtime } as never)
      })
    }
  } as unknown as HandlerContext
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  await applyForkAgentProfile('orchestration worker-start', ctx)
  return {
    agent: flags.get('agent'),
    model: flags.get('model'),
    effort: flags.get('effort'),
    spec: flags.get('spec'),
    ...readForkMcpProfileFlag(flags)
  }
}

describe('worker-start --profile reviewer (BAD-687 criterion 1)', () => {
  it('builds the agent, model, effort, MCP profile and permission mode for a terminal and a chat', async () => {
    const request = await workerStartRequest()
    expect(request).toMatchObject({
      agent: 'claude',
      model: 'sonnet',
      effort: 'high',
      forkAgentProfile: 'reviewer',
      forkMcpProfile: 'review-tools'
    })
    const scope = { request: { method: 'orchestration.workerStart', params: request } }
    const preferences = { model: String(request.model), effort: String(request.effort) }

    const terminal = await withForkMcpLaunchScope(scope, () =>
      resolveAgentTerminalCreateOptions(
        { id: 'wt_1', path: folder, connectionId: null, repo: null, folderWorkspace: null },
        {
          startupAgent: 'claude',
          launchPreferences: preferences,
          launchRuntime: {
            platform: 'darwin',
            pty: { shellOverride: undefined, terminalWindowsWslDistro: null }
          }
        },
        {
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the terminal plan reads only getSettings.
          store: { getSettings: () => settings } as never,
          hostIdentity: 'host-1',
          toSessionOptions: (values) =>
            values ? Object.fromEntries(Object.entries(values).filter(([, v]) => v)) : undefined
        }
      )
    )
    const command = terminal.command ?? ''
    expect(command).toMatch(/^claude /)
    expect(command).toContain("'--model' 'sonnet' '--effort' 'high'")
    expect(command).toContain("'--permission-mode' 'acceptEdits'")
    const file = /'--strict-mcp-config' '--mcp-config' '([^']+)'/.exec(command)?.[1]
    expect(JSON.parse(readFileSync(file!, 'utf8'))).toEqual({
      mcpServers: { lint: { command: 'lint-mcp' } }
    })

    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: createStructuredAgentSession is mocked, so the context is never read.
    const delegates = structuredAgentSessionEntryDelegates(() => ({}) as never)
    await withForkMcpLaunchScope(scope, () =>
      delegates.create(
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the mocked create reads only the params.
        { callerKey: 'k' } as never,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the create params with only the fields the hooks read.
        {
          envelope: { sessionId: 'chat-reviewer' },
          provider: 'claude',
          agent: 'claude',
          location: {},
          options: preferences
        } as never
      )
    )
    expect(createdChats[0]?.options).toEqual({
      model: 'sonnet',
      effort: 'high',
      permissionMode: 'accept-edits'
    })
    expect(await forkMcpChat('chat-reviewer')).toMatchObject({
      kind: 'worker',
      chosen: 'review-tools'
    })
  })
})
