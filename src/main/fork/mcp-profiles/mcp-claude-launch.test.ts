import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForkMcpProfileSettings } from '../../../shared/fork/mcp-profiles'
import { forkMcpClaudeLaunchArgs, type ForkMcpClaudeLaunch } from './mcp-claude-launch'
import {
  forkMcpServiceState,
  installForkMcpProfiles,
  uninstallForkMcpProfilesForTests
} from './mcp-profiles-service'

vi.mock('../../native-chat/agent-session-wire/host/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: () => null
}))

let root: string
let settings: ForkMcpProfileSettings
let launch: ForkMcpClaudeLaunch

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fork-mcp-launch-'))
  const configDir = join(root, 'account')
  const cwd = join(root, 'repo')
  await mkdir(configDir, { recursive: true })
  await mkdir(cwd, { recursive: true })
  await writeFile(
    join(configDir, '.claude.json'),
    JSON.stringify({
      mcpServers: {
        browser: { command: 'browser', env: { TOKEN: 'secret-value' } },
        slack: { url: 'https://example.invalid' }
      }
    })
  )
  settings = {
    forkMcpProfiles: [{ name: 'web', mode: 'allow', servers: ['browser'] }]
  }
  await installForkMcpProfiles({
    readSettings: () => settings,
    dataFolder: join(root, 'data'),
    chatStateFile: null
  })
  launch = {
    sessionId: 'chat-1',
    cwd,
    configDir,
    env: { CLAUDE_CONFIG_DIR: configDir },
    wsl: false,
    userArgs: {},
    policyFiles: [],
    now: () => 7
  }
})

afterEach(async () => {
  uninstallForkMcpProfilesForTests()
  await rm(root, { recursive: true, force: true })
})

const lastOf = (sessionId: string) => forkMcpServiceState()!.store.get(sessionId)?.last

describe('forkMcpClaudeLaunchArgs', () => {
  it('passes through when not installed or nothing is in use', async () => {
    settings = {}
    expect(await forkMcpClaudeLaunchArgs(launch)).toEqual({})
    expect(lastOf('chat-1')).toBeUndefined()
    uninstallForkMcpProfilesForTests()
    expect(await forkMcpClaudeLaunchArgs(launch)).toEqual({})
  })

  it('records "all" without arguments', async () => {
    expect(await forkMcpClaudeLaunchArgs(launch)).toEqual({})
    expect(lastOf('chat-1')).toEqual({ at: 7, profile: 'all', applied: false, servers: [] })
  })

  it('writes a filtered config for a named profile', async () => {
    forkMcpServiceState()!.store.update('chat-1', (c) => ({ ...c, chosen: 'web' }))
    const args = await forkMcpClaudeLaunchArgs(launch)
    expect(args['strict-mcp-config']).toBeNull()
    const file = args['mcp-config']!
    expect(file.startsWith(join(root, 'data', 'launch'))).toBe(true)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      mcpServers: { browser: { command: 'browser', env: { TOKEN: 'secret-value' } } }
    })
    expect(lastOf('chat-1')).toMatchObject({ profile: 'web', applied: true, servers: ['browser'] })
    expect(JSON.stringify(lastOf('chat-1'))).not.toContain('secret-value')
  })

  it('passes strict only for "none" via the kind default', async () => {
    settings = { ...settings, forkMcpDefaultInteractive: 'none' }
    expect(await forkMcpClaudeLaunchArgs(launch)).toEqual({ 'strict-mcp-config': null })
  })

  it('uses the project profile for the chat folder', async () => {
    settings = { ...settings, forkMcpProjectProfiles: [{ path: launch.cwd, profile: 'web' }] }
    expect(Object.keys(await forkMcpClaudeLaunchArgs(launch))).toContain('mcp-config')
  })

  it.each([
    [{ wsl: true }, /WSL/],
    [{ userArgs: { 'mcp-config': 'x.json' } }, /launch arguments/],
    [{ userArgs: { 'strict-mcp-config': null } }, /launch arguments/]
  ] as const)('skips and says why: %o', async (change, reason) => {
    settings = { ...settings, forkMcpDefaultInteractive: 'web' }
    expect(await forkMcpClaudeLaunchArgs({ ...launch, ...change })).toEqual({})
    expect(lastOf('chat-1')?.skipped).toMatch(reason)
  })

  it('skips under an enterprise policy', async () => {
    const policy = join(root, 'managed-mcp.json')
    await writeFile(policy, '{}')
    settings = { ...settings, forkMcpDefaultInteractive: 'none' }
    expect(await forkMcpClaudeLaunchArgs({ ...launch, policyFiles: [policy] })).toEqual({})
    expect(lastOf('chat-1')?.skipped).toMatch(/enterprise/)
  })
})
