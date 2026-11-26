// BAD-821 proof: a bot's stdio tool env values never reach Claude's argv. The launch goes through
// the real stream-json connection and the real SDK, which spawn a stand-in claude that records its
// argv, the config each --mcp-config names (and that file's mode), and the first stdin line.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openClaudeStreamJsonConnection } from '../../claude/claude-stream-json-connection'
import { claudeBotSessionOptions } from '../../claude/structured/launch/claude-bot-session-options'
import { SessionMcpTools } from '../../mcp-servers/session-mcp-tools'
import type { BotToolServer } from '../../../shared/bot-tools'
import { claudeSignInFolder, type BotToolsCli } from '../../bots/bot-tools-host'
import { scrubClaudeToolMirror } from '../../bots/bot-tool-secret-scrub'
import { toClaudeTrustKey } from '../../claude/configuration/claude-folder-trust-file'
import { forkMcpClaudeLaunchArgs } from './mcp-claude-launch'
import { installForkMcpProfiles, uninstallForkMcpProfilesForTests } from './mcp-profiles-service'

const MARKER = 'made-up-marker-4b1f9e'
const STDIO: BotToolServer = {
  name: 'notes',
  command: 'notes-mcp',
  args: ['--serve'],
  env: { NOTES_API_KEY: MARKER }
}
const RELAYED: BotToolServer = {
  name: 'tickets',
  url: 'https://tickets.example.test/mcp',
  credential: 'cred12345678'
}
const RECORDER = `
const fs = require('node:fs')
const argv = process.argv.slice(2)
const configs = []
argv.forEach((arg, i) => {
  if (arg !== '--mcp-config') return
  const value = argv[i + 1]
  if (value.startsWith('{')) return configs.push({ json: JSON.parse(value) })
  configs.push({ file: value, mode: fs.statSync(value).mode & 0o777, json: JSON.parse(fs.readFileSync(value, 'utf8')) })
})
let input = ''
const done = () => { fs.writeFileSync(process.env.RECORD_TO, JSON.stringify({ argv, configs, input })); process.exit(0) }
process.stdin.on('data', (chunk) => { input += chunk; if (input.includes('\\n')) done() })
setTimeout(done, 3000)
`

type Recorded = {
  argv: string[]
  configs: { file?: string; mode?: number; json: { mcpServers: Record<string, unknown> } }[]
  input: string
}

let dir: string
let settings: Record<string, unknown> = {}

async function install(): Promise<void> {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the MCP profile readers parse these lists themselves.
  const readSettings = () => settings as never
  await installForkMcpProfiles({ readSettings, dataFolder: join(dir, 'mcp'), chatStateFile: null })
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fork-bot-tools-argv-'))
  settings = {}
  await install()
})

afterEach(() => {
  uninstallForkMcpProfilesForTests()
  rmSync(dir, { recursive: true, force: true })
})

/** One bot chat launch as the real connection makes it; resolves once the stand-in exits. */
async function launch(
  extraArgs: Record<string, string | null> = {},
  resume?: string,
  mcpConfig = false
) {
  const script = join(dir, 'recorder.cjs')
  writeFileSync(script, RECORDER)
  const claude = join(dir, 'claude')
  writeFileSync(claude, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`)
  chmodSync(claude, 0o755)
  const out = join(dir, `record-${Math.random().toString(16).slice(2)}.json`)
  const tools = await SessionMcpTools.for(
    { grant: async () => ({ origin: 'http://127.0.0.1:9', token: 'relay-token' }) },
    { bot: { botId: 'bot-1', folder: dir }, agent: 'claude' },
    { own: [STDIO, RELAYED] }
  )
  const bot = await claudeBotSessionOptions({ instructions: async () => null }, [], tools, {
    mcpConfig
  })
  const connection = await openClaudeStreamJsonConnection({
    pathToClaudeCodeExecutable: claude,
    cwd: dir,
    env: { RECORD_TO: out },
    options: { ...bot, extraArgs, ...(resume ? { resume } : {}) }
  })
  await connection.exited
  await connection.close()
  return JSON.parse(readFileSync(out, 'utf8')) as Recorded
}

describe.skipIf(process.platform === 'win32')('a bot chat launch keeps tool env off argv', () => {
  it('passes the servers in a 0600 file, fresh and on resume, removed once Claude exits', async () => {
    for (const resume of [undefined, '0f0e0d0c-0b0a-4908-8706-050403020100']) {
      const seen = await launch({}, resume)
      expect(seen.argv.join('\n')).not.toContain(MARKER)
      expect(seen.configs).toHaveLength(1)
      const [config] = seen.configs
      expect(config.mode).toBe(0o600)
      expect(config.json.mcpServers.notes).toMatchObject({ env: { NOTES_API_KEY: MARKER } })
      // A relayed tool keeps the variable reference; Claude expands it from its own env.
      expect(config.json.mcpServers.tickets).toMatchObject({
        headers: { authorization: 'Bearer ${ORCA_BOT_TOOLS_TOKEN}' }
      })
      await vi.waitFor(() => expect(existsSync(config.file!)).toBe(false))
    }
  })

  it("holds an MCP profile's kept servers and the bot's in one file, still narrowed", async () => {
    const configDir = join(dir, 'claude-home')
    mkdirSync(configDir)
    writeFileSync(
      join(configDir, '.claude.json'),
      JSON.stringify({
        mcpServers: { lint: { command: 'lint-mcp' }, docs: { command: 'docs-mcp' } }
      })
    )
    settings = {
      forkMcpDefaultInteractive: 'review-tools',
      forkMcpProfiles: [{ name: 'review-tools', mode: 'allow', servers: ['lint'] }]
    }
    const profileArgs = await forkMcpClaudeLaunchArgs({
      sessionId: 'chat-1',
      cwd: dir,
      configDir,
      env: { CLAUDE_CONFIG_DIR: configDir },
      wsl: false,
      userArgs: {},
      policyFiles: []
    })
    expect(profileArgs).toHaveProperty('strict-mcp-config')
    const seen = await launch(profileArgs)
    expect(seen.argv).toContain('--strict-mcp-config')
    expect(seen.argv.join('\n')).not.toContain(MARKER)
    expect(seen.configs).toHaveLength(1)
    expect(Object.keys(seen.configs[0].json.mcpServers).sort()).toEqual([
      'lint',
      'notes',
      'tickets'
    ])
  })

  it('leaves the tools out and says so when the file cannot be written', async () => {
    uninstallForkMcpProfilesForTests()
    // A plain file where the private launch folder goes: the folder check refuses it.
    mkdirSync(join(dir, 'mcp'), { recursive: true })
    writeFileSync(join(dir, 'mcp', 'launch'), '')
    await install()
    const seen = await launch()
    expect(seen.argv.join('\n')).not.toContain(MARKER)
    expect(seen.configs).toHaveLength(0)
    expect(seen.input).toContain('Your own tools (MCP servers) are off in this session')
  })

  it('starts without the tools and says so when managed settings refuse --mcp-config', async () => {
    const seen = await launch({}, undefined, true)
    expect(seen.argv).not.toContain('--mcp-config')
    expect(seen.input).toContain("your organization's Claude Code managed settings refuse them")
  })

  it("sweeps a crashed run's bot files at start, and keeps a fresh profile file", async () => {
    uninstallForkMcpProfilesForTests()
    const folder = join(dir, 'mcp', 'launch')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'bot-0123abcd.json'), '{}')
    writeFileSync(join(folder, 'chat-1.json'), '{}')
    await install()
    expect(existsSync(join(folder, 'bot-0123abcd.json'))).toBe(false)
    expect(existsSync(join(folder, 'chat-1.json'))).toBe(true)
  })
})

describe.skipIf(process.platform === 'win32')(
  "a bot's sign-in mirror keeps tool env off argv",
  () => {
    /** A Claude CLI stand-in that logs each call's arguments, one call per line. */
    function cli(): { cli: BotToolsCli; calls: () => string } {
      const log = join(dir, 'calls.log')
      const claude = join(dir, 'claude-cli')
      writeFileSync(claude, `#!/bin/sh\necho "$*" >> '${log}'\n`)
      chmodSync(claude, 0o755)
      const accountHome = join(dir, 'account')
      mkdirSync(accountHome, { recursive: true })
      return {
        cli: {
          botId: 'bot-1',
          folder: join(dir, 'bot'),
          signInFolder: join(dir, 'sign-in'),
          otherBotFolders: [],
          agent: 'claude',
          command: claude,
          prefixArgs: [],
          env: {},
          accountHome
        },
        calls: () => (existsSync(log) ? readFileSync(log, 'utf8') : '')
      }
    }

    it('mirrors only the tool that signs in, never a command tool', async () => {
      const { cli: home, calls } = cli()
      writeFileSync(join(home.accountHome!, '.claude.json'), '{}')
      const wiki: BotToolServer = { name: 'wiki', url: 'https://wiki.example.test/mcp' }
      await claudeSignInFolder(home, [STDIO, wiki])
      expect(calls()).toContain('mcp add-json --scope local wiki')
      expect(calls()).not.toContain('notes')
      expect(calls()).not.toContain(MARKER)
    })

    it("removes an older Orca's mirror of a command tool's env values", async () => {
      const { cli: home, calls } = cli()
      mkdirSync(home.signInFolder, { recursive: true })
      const key = toClaudeTrustKey(home.signInFolder, 'posix')
      writeFileSync(
        join(home.accountHome!, '.claude.json'),
        JSON.stringify({
          projects: {
            [key]: {
              mcpServers: { notes: { command: 'notes-mcp', env: { NOTES_API_KEY: MARKER } } }
            }
          }
        })
      )
      await scrubClaudeToolMirror(home)
      expect(calls()).toContain('mcp remove --scope local notes')
    })
  }
)
