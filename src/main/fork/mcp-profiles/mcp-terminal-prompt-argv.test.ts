// BAD-800 proof: a Claude terminal started with an MCP profile and a prompt takes the prompt as the
// prompt. Claude's --mcp-config takes several values, so `--mcp-config <file> 'PROMPT'` read the
// prompt as a second config file and exited. The command comes from the real terminal plan (fresh
// and resumed, and a chat's argv as the real SDK spawns it); it is parsed by a stand-in parser for Claude's variadic options, and by the
// installed claude with ORCA_REAL_CLAUDE_CLI_TEST=1 (the repo's opt-in for real agent CLIs).
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveAgentTerminalCreateOptions } from '../../runtime/terminal/launch/runtime-agent-terminal-startup'
import type { TerminalCreateOptions } from '../../runtime/terminal/launch/terminal-create-options'
import { buildAgentResumeStartupPlan } from '../../../shared/agent-launch/startup/tui-agent-resume-startup'
import { findClaudeExecutableIndex } from '../../../shared/agent-launch/startup/agent-resume-launch-command'
import { tokenizeStartupCommand } from '../../../shared/agent-launch/startup/tui-agent-startup-shell'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { forkMcpClaudeLaunchArgs } from './mcp-claude-launch'
import { runInForkMcpLaunchScope } from './mcp-launch-scope'
import { runInForkAgentProfileLaunch } from '../agent-profiles/agent-profile-launch-scope'
import { FORK_CLAUDE_TERMINAL_ACCOUNT_ENV } from '../../../shared/fork/claude-account-move'
import { buildWorktreeStartupForAgent } from '../../runtime/workspaces/startup/runtime-worktree-agent-startup'
import { installForkMcpProfiles, uninstallForkMcpProfilesForTests } from './mcp-profiles-service'

const PROMPT = 'Lint the repo and report.'
const UNKNOWN_SESSION = '0f0e0d0c-0b0a-4908-8706-050403020100'
const settings = {
  agentPermissionDefault: 'full-access',
  // A chat with no choice of its own takes this one.
  forkMcpDefaultInteractive: 'review-tools',
  forkMcpProfiles: [{ name: 'review-tools', mode: 'allow', servers: ['lint'] }]
}

let dir: string
let savedConfigDir: string | undefined

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fork-mcp-prompt-'))
  savedConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = join(dir, 'claude')
  mkdirSync(process.env.CLAUDE_CONFIG_DIR)
  writeFileSync(
    join(process.env.CLAUDE_CONFIG_DIR, '.claude.json'),
    JSON.stringify({ mcpServers: { lint: { command: 'lint-mcp' }, docs: { command: 'docs-mcp' } } })
  )
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the MCP profile readers parse these lists themselves.
  const readSettings = () => settings as never
  await installForkMcpProfiles({ readSettings, dataFolder: join(dir, 'mcp'), chatStateFile: null })
})

afterEach(() => {
  uninstallForkMcpProfilesForTests()
  if (savedConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = savedConfigDir
  }
  rmSync(dir, { recursive: true, force: true })
})

/** The real terminal plan of a Claude terminal with `review-tools`, as a run's launch makes it. */
function launchWithProfile(): Promise<TerminalCreateOptions> {
  const opts: TerminalCreateOptions = {
    startupAgent: 'claude',
    startupPrompt: PROMPT,
    launchRuntime: {
      platform: 'darwin',
      pty: { shellOverride: undefined, terminalWindowsWslDistro: null }
    }
  }
  return runInForkMcpLaunchScope({ kind: 'background', profile: 'review-tools' }, () =>
    resolveAgentTerminalCreateOptions(
      { id: 'wt-1', path: dir, connectionId: null, repo: null, folderWorkspace: null },
      opts,
      {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the terminal plan reads only getSettings.
        store: { getSettings: () => settings } as never,
        hostIdentity: 'host-1',
        toSessionOptions: () => undefined
      }
    )
  )
}

/** A new workspace's startup agent under a `--profile` (mode accept-edits, MCP review-tools, a
 *  Claude account), which builds its own command (`worktree create --agent`, a new_per_run run). */
async function newWorkspaceStartup(connectionId: string | null = null) {
  const profile = {
    name: 'nightly',
    agent: 'claude',
    permissionMode: 'accept-edits' as const,
    account: { kind: 'claude' as const, pin: 'acct-1', label: 'Work', ref: 'acct-1' }
  }
  const built = await runInForkMcpLaunchScope({ kind: 'background', profile: 'review-tools' }, () =>
    runInForkAgentProfileLaunch(profile, () =>
      buildWorktreeStartupForAgent({
        repo: { path: dir, connectionId, executionHostId: undefined },
        agent: 'claude',
        prompt: PROMPT,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the startup plan reads these settings fields only.
        settings: settings as never,
        getLaunchRuntime: () => ({
          platform: 'darwin',
          shell: 'posix',
          launchRuntime: {
            platform: 'darwin',
            pty: { shellOverride: undefined, terminalWindowsWslDistro: null }
          }
        }),
        toSessionOptions: (preferences) => (preferences ? { ...preferences } : undefined)
      })
    )
  )
  return built.startup
}

/** The words after `claude` in a built command. */
function claudeArgs(command: string): string[] {
  const parsed = tokenizeStartupCommand(command, 'posix')
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }
  const at = findClaudeExecutableIndex(parsed.tokens, 'posix')
  expect(at).toBeGreaterThanOrEqual(0)
  return parsed.tokens.slice(at + 1)
}

const VARIADIC = new Set(['--mcp-config', '--add-dir', '--allowedTools', '--disallowedTools'])
const VALUED = new Set([
  '--permission-mode',
  '--model',
  '--resume',
  '--effort',
  '--input-format',
  '--output-format'
])

/**
 * Stand-in for Claude's option parser (commander): a variadic option takes every following word up
 * to the next option, `--name=value` is one value and starts no list, and `--` ends the options.
 */
function standInClaudeParse(args: readonly string[]): {
  prompt: string[]
  values: Record<string, string[]>
} {
  const prompt: string[] = []
  const values: Record<string, string[]> = {}
  let list: string[] | null = null
  for (let i = 0; i < args.length; i += 1) {
    const word = args[i]!
    if (word === '--') {
      prompt.push(...args.slice(i + 1))
      break
    }
    if (word.startsWith('-')) {
      const [name, inline] = word.split(/=(.*)/s)
      const kept = (values[name!] ??= [])
      list = null
      if (inline !== undefined) {
        kept.push(inline)
      } else if (VARIADIC.has(name!)) {
        list = kept
      } else if (VALUED.has(name!)) {
        kept.push(args[++i] ?? '')
      }
      continue
    }
    ;(list ?? prompt).push(word)
  }
  return { prompt, values }
}

/**
 * The installed claude's own reading of `args`, asked to resume a session that does not exist so
 * it stops right after parsing, in a throwaway config folder, without reaching the network for a
 * turn.
 */
function realClaudeReading(claude: string, args: readonly string[]): string {
  const run = spawnSync(claude, ['--resume', UNKNOWN_SESSION, ...args], {
    encoding: 'utf8',
    input: '',
    timeout: 60_000,
    cwd: dir,
    env: { ...process.env, CLAUDE_CONFIG_DIR: join(dir, 'claude') }
  })
  return `${run.stdout}\n${run.stderr}`
}

/** The argv the real SDK gives Claude for a chat with the profile's extra args (a stand-in
 *  executable records it); the prompt goes on stdin. */
async function chatArgv(): Promise<string[]> {
  const extraArgs = await forkMcpClaudeLaunchArgs({
    sessionId: 'chat-1',
    cwd: dir,
    configDir: join(dir, 'claude'),
    env: { CLAUDE_CONFIG_DIR: join(dir, 'claude') },
    wsl: false,
    userArgs: {},
    policyFiles: []
  })
  const out = join(dir, 'chat-argv.txt')
  const recorder = join(dir, 'argv-recorder.sh')
  writeFileSync(recorder, `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > '${out}'\n`)
  chmodSync(recorder, 0o755)
  async function* prompt() {
    yield {
      type: 'user' as const,
      message: { role: 'user' as const, content: PROMPT },
      parent_tool_use_id: null,
      session_id: ''
    }
  }
  const run = query({
    prompt: prompt(),
    options: { pathToClaudeCodeExecutable: recorder, extraArgs, resume: UNKNOWN_SESSION }
  })
  try {
    for await (const message of run) {
      void message
    }
  } catch {
    // The recorder exits at once; the argv is what this reads.
  }
  return readFileSync(out, 'utf8').split('\n').filter(Boolean)
}

describe('a Claude terminal with an MCP profile and a prompt (BAD-800)', () => {
  it('keeps the prompt out of --mcp-config, fresh and resumed', async () => {
    const built = await launchWithProfile()
    const args = claudeArgs(built.command ?? '')
    const fresh = standInClaudeParse(args)
    expect(fresh.prompt).toEqual([PROMPT])
    expect(fresh.values['--mcp-config']).toHaveLength(1)
    expect(fresh.values['--strict-mcp-config']).toEqual([])
    const file = fresh.values['--mcp-config']![0]!
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      mcpServers: { lint: { command: 'lint-mcp' } }
    })
    // The stand-in reads the old spaced form as the live failure did.
    expect(standInClaudeParse(['--mcp-config', file, PROMPT]).prompt).toEqual([])

    // A resume replays the recorded arguments; a word after them is still a prompt.
    const resumed = buildAgentResumeStartupPlan({
      agent: 'claude',
      providerSession: { key: 'session_id', id: UNKNOWN_SESSION },
      cmdOverrides: {},
      platform: 'darwin',
      agentArgs: built.launchConfig?.agentArgs ?? null,
      agentCommand: built.launchConfig?.agentCommand ?? null
    })
    const resumeArgs = [...claudeArgs(resumed?.launchCommand ?? ''), PROMPT]
    expect(resumeArgs.join(' ')).toContain(`--mcp-config=${file}`)
    expect(standInClaudeParse(resumeArgs).prompt).toEqual([PROMPT])
  })

  it("applies the profile to a new workspace's startup agent, prompt kept", async () => {
    const startup = await newWorkspaceStartup()
    // BAD-815: the pane account marker the spawn turns into that account's Claude folder.
    expect(startup.env?.[FORK_CLAUDE_TERMINAL_ACCOUNT_ENV]).toBe('acct-1')
    await expect(newWorkspaceStartup('ssh-1')).rejects.toThrow(
      'Profile "nightly" runs on Claude account Work, which cannot apply to this new workspace\'s agent: it runs on a remote host.'
    )
    const parsed = standInClaudeParse(claudeArgs(startup.command))
    expect(parsed.prompt).toEqual([PROMPT])
    // Settings allow full access; the profile's capped mode wins, never wider.
    expect(parsed.values['--permission-mode']).toEqual(['acceptEdits'])
    expect(parsed.values['--dangerously-skip-permissions']).toBeUndefined()
    expect(parsed.values['--strict-mcp-config']).toEqual([])
    const file = parsed.values['--mcp-config']?.[0]
    expect(parsed.values['--mcp-config']).toHaveLength(1)
    expect(JSON.parse(readFileSync(file!, 'utf8'))).toEqual({
      mcpServers: { lint: { command: 'lint-mcp' } }
    })
  })

  it('gives a chat one --mcp-config value and no stray word', async () => {
    const parsed = standInClaudeParse(await chatArgv())
    expect(parsed.prompt).toEqual([])
    const file = parsed.values['--mcp-config']?.[0]
    expect(parsed.values['--mcp-config']).toHaveLength(1)
    expect(JSON.parse(readFileSync(file!, 'utf8'))).toEqual({
      mcpServers: { lint: { command: 'lint-mcp' } }
    })
  })

  it.skipIf(process.env.ORCA_REAL_CLAUDE_CLI_TEST !== '1')(
    'is read the same way by the installed claude, terminal and chat',
    async () => {
      const args = claudeArgs((await launchWithProfile()).command ?? '')
      for (const reading of [
        realClaudeReading('claude', args),
        realClaudeReading('claude', claudeArgs((await newWorkspaceStartup()).command)),
        realClaudeReading('claude', [...(await chatArgv()), '--print'])
      ]) {
        expect(reading).not.toMatch(/MCP config file not found|read as a value of --mcp-config/)
        expect(reading).toMatch(/No conversation found/)
      }
    },
    90_000
  )
})
