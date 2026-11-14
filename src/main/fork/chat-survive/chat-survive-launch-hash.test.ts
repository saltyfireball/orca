import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PipedProcessSpec } from '@orca/process-host/process-spec'
import { POSIX_PROVIDER_SUPERVISOR_SCRIPT } from '../../provider-process/provider-process-supervisor'
import {
  chatSurviveLaunchDiff,
  chatSurviveLaunchPrint,
  readChatSurviveLaunchPrint,
  type ChatSurviveLaunchPrint
} from './chat-survive-launch-hash'

function supervised(args: string[], cwd = '/work'): PipedProcessSpec {
  return {
    program: '/bin/sh',
    args: ['-e', POSIX_PROVIDER_SUPERVISOR_SCRIPT, '--', 'claude', ...args],
    cwd,
    stdio: 'pipe'
  }
}

const ENV = { ANTHROPIC_MODEL: 'haiku', ORCA_AGENT_SESSION_ID: 'sess', PATH: '/bin' }

function print(
  spec: PipedProcessSpec,
  env: Record<string, string | undefined> = ENV
): ChatSurviveLaunchPrint {
  const made = chatSurviveLaunchPrint(spec, env)
  if (!made) {
    throw new Error('not a provider supervisor spawn')
  }
  return made
}

/** The part names in which the second launch differs from the first. */
function diff(
  first: [string[], Record<string, string | undefined>?],
  second: [string[], Record<string, string | undefined>?]
): string[] {
  return chatSurviveLaunchDiff(
    print(supervised(first[0]), first[1]),
    print(supervised(second[0]), second[1])
  )
}

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'csl-'))
  dirs.push(dir)
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

// As Claude Agent SDK 0.3.319 writes a chat's launch: flags with `=` or as two args, the resume
// flag earlier than the session id of a first launch.
const HEAD = ['--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json']
const TAIL = [
  '--model',
  'opus',
  '--effort',
  'high',
  '--permission-mode',
  'default',
  '--add-dir',
  '/data/attachments',
  '--add-dir',
  '/data/chat-scratch/abc',
  '--plugin-dir',
  '/app/resources/native-chat-visuals',
  '--replay-user-messages'
]

/** The env one app version gives the provider of the same chat. */
function appEnv(version: string, run: number): Record<string, string> {
  return {
    PATH: `/usr/bin:/bin:/run-${run}`,
    ORCA_APP_VERSION: version,
    ORCA_AGENT_SESSION_ID: 'sess',
    ORCA_AGENT_SESSION_SPAWN_TOKEN: `token-${run}`,
    ORCA_AGENT_HOOK_PORT: String(40_000 + run),
    ORCA_USER_DATA_PATH: '/data',
    ORCA_CLI_BIN_DIR: '/app/resources/bin',
    ORCA_CLI_COMMAND: 'orca',
    ORCA_CHAT_SCRATCH_DIR: '/data/chat-scratch/abc',
    ORCA_ENVIRONMENT: '',
    CLAUDE_CONFIG_DIR: '/data/claude-accounts/a',
    CLAUDE_CODE_ENTRYPOINT: 'orca',
    CLAUDE_AGENT_SDK_VERSION: '0.3.319'
  }
}

describe('chat-survive launch fingerprint', () => {
  it('is the same launch for the same chat under two app versions', () => {
    const first = print(supervised([...HEAD, ...TAIL, '--session-id=abc']), appEnv('1.4.0', 1))
    const afterUpdate = print(supervised([...HEAD, '--resume=abc', ...TAIL]), appEnv('1.5.0', 2))
    expect(chatSurviveLaunchDiff(first, afterUpdate)).toEqual([])
    // The app version is no part at all, so no future value of it can matter.
    expect(Object.keys(first.parts)).not.toContain('env:ORCA_APP_VERSION')
    expect(Object.keys(first.parts)).toContain('env:CLAUDE_AGENT_SDK_VERSION')
  })

  it('is the same for a resume of the same launch, whatever per-run noise changed', () => {
    const noise = (run: string): Record<string, string> => ({
      ...ENV,
      ORCA_AGENT_SESSION_SPAWN_TOKEN: run,
      ORCA_AGENT_HOOK_PORT: `${run}000`,
      XPC_SERVICE_NAME: `application.${run}`,
      PATH: `/usr/bin:/bin:${run}`
    })
    expect(
      diff(
        [['--session-id', 'abc', '--model', 'x'], noise('1')],
        [['--resume', 'abc', '--model', 'x'], noise('2')]
      )
    ).toEqual([])
    // The SDK writes them with `=`.
    expect(
      diff([['--session-id=abc', '--model', 'x']], [['--resume=abc', '--model', 'x']])
    ).toEqual([])
    expect(diff([['--resume=abc', '--model', 'x']], [['--resume', 'abc', '--model', 'x']])).toEqual(
      []
    )
    expect(diff([['--resume=abc', '--model', 'x']], [['--resume=xyz', '--model', 'x']])).toEqual([
      'session'
    ])
  })

  it('names what a real difference is in, and never its value', () => {
    expect(diff([['--model', 'opus']], [['--model', 'sonnet']])).toEqual(['arg:--model'])
    // `--flag value` and `--flag=value` are the same flag.
    expect(diff([['--model', 'opus']], [['--model=opus']])).toEqual([])
    expect(diff([['--permission-mode', 'default']], [['--permission-mode', 'plan']])).toEqual([
      'arg:--permission-mode'
    ])
    expect(diff([['--effort', 'high']], [['--effort', 'low']])).toEqual(['arg:--effort'])
    expect(diff([['--add-dir', '/a', '--add-dir', '/b']], [['--add-dir', '/a']])).toEqual([
      'arg order',
      'arg:--add-dir'
    ])
    expect(diff([['--model', 'x']], [['--model', 'x', '--strict-mcp-config']])).toEqual([
      'arg order',
      'arg:--strict-mcp-config'
    ])
    expect(
      diff([['--settings', '{"fastMode":true}']], [['--settings', '{"fastMode":false}']])
    ).toEqual(['arg:--settings'])
    expect(diff([['--model', 'x', '--verbose']], [['--verbose', '--model', 'x']])).toEqual([
      'arg order'
    ])
    expect(diff([[], ENV], [[], { ...ENV, ANTHROPIC_MODEL: 'opus' }])).toEqual([
      'env:ANTHROPIC_MODEL'
    ])
    expect(diff([[], ENV], [[], { ...ENV, CLAUDE_CONFIG_DIR: '/c' }])).toEqual([
      'env:CLAUDE_CONFIG_DIR'
    ])
    expect(
      diff(
        [[], { ...ENV, CLAUDE_AGENT_SDK_VERSION: '0.3.319' }],
        [[], { ...ENV, CLAUDE_AGENT_SDK_VERSION: '0.4.0' }]
      )
    ).toEqual(['env:CLAUDE_AGENT_SDK_VERSION'])
    expect(
      chatSurviveLaunchDiff(print(supervised([], '/work')), print(supervised([], '/other')))
    ).toEqual(['cwd'])
    const saved = JSON.stringify(print(supervised(['--model', 'opus-secret'], '/work/secret')))
    expect(saved).not.toContain('secret')
    expect(saved).not.toContain('haiku')
  })

  it('compares a config file a flag names by its content, not only its path', () => {
    const servers = (command: string): string => JSON.stringify({ mcpServers: { a: { command } } })
    const path = tempFile('chat.json', servers('one'))
    const args = ['--strict-mcp-config', '--mcp-config', path]
    const first = print(supervised(args))
    expect(chatSurviveLaunchDiff(first, print(supervised(args)))).toEqual([])
    // The chat's MCP config is rewritten in place on every start: same path, other servers.
    writeFileSync(path, servers('two'))
    expect(chatSurviveLaunchDiff(first, print(supervised(args)))).toEqual(['arg:--mcp-config'])
    // A file that cannot be read matches only while it stays unreadable.
    rmSync(path)
    const gone = print(supervised(args))
    expect(chatSurviveLaunchDiff(first, gone)).toEqual(['arg:--mcp-config'])
    expect(chatSurviveLaunchDiff(gone, print(supervised(args)))).toEqual([])
    // Another path with the same content is still another launch.
    const settings = tempFile('one.json', '{}')
    const copy = tempFile('two.json', '{}')
    expect(diff([['--settings', settings]], [['--settings', copy]])).toEqual(['arg:--settings'])
  })

  it('reads back only a fingerprint in this format', () => {
    const made = print(supervised(['--model', 'x']))
    expect(readChatSurviveLaunchPrint(JSON.parse(JSON.stringify(made)))).toEqual(made)
    // The single hash earlier releases saved, and anything else, matches nothing.
    expect(readChatSurviveLaunchPrint('a'.repeat(64))).toBeNull()
    expect(readChatSurviveLaunchPrint(undefined)).toBeNull()
    expect(readChatSurviveLaunchPrint({ ...made, v: 1 })).toBeNull()
    expect(readChatSurviveLaunchPrint({ ...made, v: 3 })).toBeNull()
    expect(readChatSurviveLaunchPrint({ v: 2, parts: {} })).toBeNull()
    expect(readChatSurviveLaunchPrint({ v: 2, parts: { cwd: 'not a hash' } })).toBeNull()
    expect(readChatSurviveLaunchPrint({ v: 2, parts: [] })).toBeNull()
  })

  it('has nothing to say about a spawn that is not a provider supervisor', () => {
    expect(chatSurviveLaunchPrint({ program: 'claude', args: [], stdio: 'pipe' }, ENV)).toBeNull()
  })
})
