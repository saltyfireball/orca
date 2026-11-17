import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpawnOptions as SdkSpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { spawnProcess } from '@orca/process-host'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ProcessSpec } from '@orca/process-host/process-spec'
import { proveClaudeChildExit } from '../../claude/child-process/claude-agent-sdk-exit-proof'
import { createClaudeCodeProcessSpawn } from '../../claude/child-process/claude-agent-sdk-process-spawn'
import { PassThrough } from 'node:stream'
import { CHAT_SURVIVE_SPEC_ENV } from './chat-survive-broker-spec'
import {
  chatSurviveClaimStopping,
  dropChatSurviveClaim,
  hasChatSurviveClaim,
  holdChatSurviveClaim
} from './chat-survive-claims'
import type { ChatSurviveConnection, ChatSurviveConnectionEnd } from './chat-survive-client'
import { chatSurviveLaunchPrint } from './chat-survive-launch-hash'
import { POSIX_PROVIDER_SUPERVISOR_SCRIPT } from '../../provider-process/provider-process-supervisor'
import type { ChatSurviveRecord } from './chat-survive-registry'
import {
  refreshChatSurviveLaunchReady,
  resetChatSurviveLaunchReadyForTests
} from './chat-survive-launch-ready'
import { forkLegacyProviderLaunch } from './chat-survive-legacy-launch'
import { supervisorSpawnSpec } from './chat-survive-supervisor-spec.test-fixture'
import {
  chatSurviveRecordName,
  forkChatSurviveSpawner,
  setChatSurviveConfigReader
} from './chat-survive-spawn'

const ENTRY = join(import.meta.dirname, 'chat-survive-broker-entry.ts')
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href

// Says its pid on stdout, then waits for input; SIGTERM ends it by default.
const FAKE_CLAUDE = `
process.stdin.resume()
process.stdout.write(JSON.stringify({ claude: process.pid }) + '\\n')
`

const dirs: string[] = []
const pids = new Set<number>()

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

beforeEach(() => refreshChatSurviveLaunchReady(ENTRY))

afterEach(() => {
  resetChatSurviveLaunchReadyForTests()
  setChatSurviveConfigReader(null)
  // Only processes these tests started, by their own pids.
  for (const pid of pids) {
    if (alive(pid)) {
      process.kill(pid, 'SIGKILL')
    }
  }
  pids.clear()
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'css-'))
  dirs.push(dir)
  return dir
}

function supervisorSpawn(): ProcessSpec {
  return supervisorSpawnSpec({ command: process.execPath, args: ['-e', FAKE_CLAUDE] })
}

/** Records each spec and runs a stand-in: `true`, or Node with `nodeArgs` to stay up a while. */
function recordingSpawner(nodeArgs?: string[]): {
  specs: ProcessSpec[]
  spawn: (spec: ProcessSpec) => ChildProcessWithoutNullStreams
} {
  const specs: ProcessSpec[] = []
  return {
    specs,
    spawn: (spec) => {
      specs.push(spec)
      return nodeArgs
        ? spawnProcess({
            program: process.execPath,
            args: nodeArgs,
            stdio: ['pipe', 'pipe', 'pipe']
          })
        : spawnProcess({ program: 'true', stdio: ['pipe', 'pipe', 'pipe'] })
    }
  }
}

function enable(recordDir: string, entryPath: string = ENTRY, enabled = true): void {
  setChatSurviveConfigReader(() => ({ enabled, recordDir, entryPath }))
}

describe('chat-survive spawn hook', () => {
  it('spawns as today unless switched on for a supervisor spawn it can plan', () => {
    const supervisor = supervisorSpawn()
    // As the default does: no socket folder unless the broker entry is on disk.
    const socketDir = (entryPath: string): string | null =>
      existsSync(entryPath) ? tempDir() : null
    const cases: { setup: () => void; spec?: ProcessSpec; platform?: NodeJS.Platform }[] = [
      { setup: () => setChatSurviveConfigReader(null) },
      { setup: () => enable(tempDir(), ENTRY, false) },
      { setup: () => enable(tempDir(), '/no/such/entry.js') },
      {
        setup: () =>
          setChatSurviveConfigReader(() => {
            throw new Error('store gone')
          })
      },
      { setup: () => enable(tempDir()), platform: 'win32' },
      { setup: () => enable(tempDir()), spec: { program: 'claude', args: ['--print'] } }
    ]
    for (const { setup, spec, platform } of cases) {
      setup()
      const base = recordingSpawner()
      const input = spec ?? supervisor
      const spawner = forkChatSurviveSpawner(base.spawn, platform ?? 'darwin', {}, socketDir)
      // No broker can run, so upstream keeps its native launcher (SLRM-2316).
      expect(forkLegacyProviderLaunch(spawner)).toBe(spec !== undefined)
      spawner(input)
      expect(base.specs).toEqual([input])
    }
    enable(tempDir())
    const base = recordingSpawner()
    const spawner = forkChatSurviveSpawner(base.spawn, 'darwin', {}, () => null)
    expect(forkLegacyProviderLaunch(spawner)).toBe(false)
    spawner(supervisor)
    expect(base.specs).toEqual([supervisor])
  })

  it('runs the supervisor under a broker and keeps a private record until the broker exits', async () => {
    const recordDir = join(tempDir(), 'chat-survive')
    enable(recordDir)
    const supervisor = supervisorSpawn()
    const base = recordingSpawner(['-e', 'setTimeout(() => {}, 1500)'])
    const spawner = forkChatSurviveSpawner(
      base.spawn,
      'linux',
      { ORCA_AGENT_SESSION_ID: 'abc-1' },
      () => tempDir()
    )
    // A broker runs upstream's Node supervisor, so this spawn asks for it (SLRM-2316).
    expect(forkLegacyProviderLaunch(spawner)).toBe(true)
    const child = spawner(supervisor)
    if (child.pid !== undefined) {
      pids.add(child.pid)
    }
    const [spawned] = base.specs
    expect(spawned?.args).toEqual([ENTRY, '--', supervisor.program, ...(supervisor.args ?? [])])
    expect(spawned?.env?.[CHAT_SURVIVE_SPEC_ENV]).toBeTruthy()
    const name = `abc-1.${child.pid}.json`
    const path = join(recordDir, name)
    // The record is written off the spawn path, and removed only after that write.
    await vi.waitFor(() => expect(existsSync(path)).toBe(true), { timeout: 5000, interval: 20 })
    const record: unknown = JSON.parse(readFileSync(path, 'utf8'))
    expect(record).toMatchObject({ v: 1, sessionId: 'abc-1', brokerPid: child.pid })
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(recordDir).mode & 0o777).toBe(0o700)
    await vi.waitFor(() => expect(existsSync(path)).toBe(false), { timeout: 5000, interval: 20 })
  })

  it('refuses a spawn of any shape for a chat whose surviving provider is held', () => {
    const recordDir = join(tempDir(), 'chat-survive')
    enable(recordDir)
    const stopped = vi.fn()
    const connection: ChatSurviveConnection = {
      welcome: {
        t: 'welcome',
        v: 1,
        pid: 1,
        fence: 1,
        out: { first: 0, end: 0, truncated: false },
        err: { first: 0, end: 0, truncated: false },
        exit: null
      },
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      offsets: () => ({ out: 0, err: 0 }),
      write: () => {},
      endInput: () => {},
      stop: stopped,
      release: () => {},
      detach: () => {},
      exited: new Promise(() => {}),
      ended: new Promise(() => {})
    }
    const record: ChatSurviveRecord & { sessionId: string } = {
      v: 1,
      sessionId: 'held',
      brokerPid: 1,
      socketPath: '',
      token: ''
    }
    const mark = { out: 0, err: 0, seen: 0, delivered: 0, pending: [] }
    holdChatSurviveClaim({ connection, record, recordPath: join(recordDir, 'x'), mark, fence: 2 })
    const base = recordingSpawner()
    const spawn = forkChatSurviveSpawner(base.spawn, 'darwin', { ORCA_AGENT_SESSION_ID: 'held' })
    // A held provider is adopted in the Node supervisor's place, so its chat's start asks for it.
    expect(forkLegacyProviderLaunch(spawn)).toBe(true)
    expect(() => spawn({ program: 'claude', args: ['--print'] })).toThrow(/held for adoption/)
    expect(base.specs).toEqual([])
    dropChatSurviveClaim('held')
    expect(stopped).toHaveBeenCalled()
    // Until the dropped provider has stopped, nothing new starts for the chat either.
    expect(() => spawn({ program: 'claude', args: ['--print'] })).toThrow(/still stopping/)
  })

  it('names records only from plain session ids', () => {
    expect(chatSurviveRecordName({ ORCA_AGENT_SESSION_ID: 'a_B-9' }, 7)).toBe('a_B-9.7.json')
    expect(chatSurviveRecordName({ ORCA_AGENT_SESSION_ID: '../x' }, 7)).toBe('session.7.json')
    expect(chatSurviveRecordName({}, 7)).toBe('session.7.json')
  })
})

describe('chat-survive launch check', () => {
  // No process has this pid, so nothing here could ever signal a real one.
  const GONE_PID = 2_147_483_646

  /** A chat's provider launch as the app hands it to the spawn hook. */
  function launch(args: string[]): ProcessSpec {
    return {
      program: '/bin/sh',
      args: ['-e', POSIX_PROVIDER_SUPERVISOR_SCRIPT, '--', 'claude', ...args],
      cwd: '/work',
      stdio: 'pipe'
    }
  }

  function appEnv(version: string, session: string): Record<string, string> {
    return {
      ORCA_AGENT_SESSION_ID: session,
      ORCA_APP_VERSION: version,
      ORCA_AGENT_SESSION_SPAWN_TOKEN: `token-of-${version}`,
      CLAUDE_AGENT_SDK_VERSION: '0.3.319',
      CLAUDE_CONFIG_DIR: '/accounts/a'
    }
  }

  /** A broker the earlier app instance handed off, claimed and held for this chat's next start. */
  function held(session: string, spec: ProcessSpec, env: Record<string, string>) {
    const recordDir = join(tempDir(), 'chat-survive')
    const recordPath = join(recordDir, `${session}.${GONE_PID}.json`)
    const ended = Promise.withResolvers<ChatSurviveConnectionEnd>()
    const stop = vi.fn(() => ended.resolve('closed'))
    const connection: ChatSurviveConnection = {
      welcome: {
        t: 'welcome',
        v: 1,
        pid: GONE_PID,
        fence: 2,
        out: { first: 0, end: 0, truncated: false },
        err: { first: 0, end: 0, truncated: false },
        exit: null
      },
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      offsets: () => ({ out: 0, err: 0 }),
      write: () => {},
      endInput: () => {},
      stop,
      release: () => {},
      detach: () => {},
      exited: new Promise(() => {}),
      ended: ended.promise
    }
    const made = chatSurviveLaunchPrint(spec, env)
    const record: ChatSurviveRecord & { sessionId: string } = {
      v: 1,
      sessionId: session,
      brokerPid: GONE_PID,
      socketPath: '',
      token: 'secret-token',
      ...(made ? { launch: made } : {})
    }
    const mark = { out: 0, err: 0, seen: 0, delivered: 0, pending: [] }
    holdChatSurviveClaim({ connection, record, recordPath, mark, fence: 2 })
    return { stop, recordPath, recordDir }
  }

  const MODEL = ['--model', 'opus', '--permission-mode', 'default']

  it('takes the claim for the same chat started by another app version', () => {
    const { stop } = held('upd', launch([...MODEL, '--session-id=abc']), appEnv('1.4.0', 'upd'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const base = recordingSpawner()
    try {
      const child = forkChatSurviveSpawner(
        base.spawn,
        'darwin',
        appEnv('1.5.0', 'upd')
      )(launch(['--resume=abc', ...MODEL]))
      // The broker in place of a new provider: nothing spawned, nothing stopped, nothing refused.
      expect(child.pid).toBe(GONE_PID)
      expect(base.specs).toEqual([])
      expect(stop).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
      expect(hasChatSurviveClaim('upd')).toBe(false)
      expect(chatSurviveClaimStopping('upd')).toBe(false)
    } finally {
      warn.mockRestore()
    }
  })

  it('refuses a provider configured otherwise, says in what, and removes its record', async () => {
    const mcp = join(tempDir(), 'chat.json')
    const withMcp = [...MODEL, '--strict-mcp-config', '--mcp-config', mcp]
    const cases: {
      name: string
      saved: string[]
      now: string[]
      env?: Record<string, string>
      before?: () => void
      differs: string
      hidden: string[]
    }[] = [
      {
        name: 'model',
        saved: MODEL,
        now: ['--model', 'sonnet-other', '--permission-mode', 'default'],
        differs: 'arg:--model',
        hidden: ['opus', 'sonnet-other']
      },
      {
        name: 'mode',
        saved: MODEL,
        now: ['--model', 'opus', '--permission-mode', 'bypassPermissions'],
        differs: 'arg:--permission-mode',
        hidden: ['bypassPermissions', 'opus']
      },
      {
        name: 'mcp',
        saved: withMcp,
        now: withMcp,
        before: () => writeFileSync(mcp, '{"mcpServers":{"b":{"command":"other-server"}}}'),
        differs: 'arg:--mcp-config',
        hidden: ['other-server', 'first-server', mcp]
      },
      {
        name: 'account',
        saved: MODEL,
        now: MODEL,
        env: { CLAUDE_CONFIG_DIR: '/accounts/b' },
        differs: 'env:CLAUDE_CONFIG_DIR',
        hidden: ['/accounts/a', '/accounts/b']
      },
      {
        name: 'sdk',
        saved: MODEL,
        now: MODEL,
        env: { CLAUDE_AGENT_SDK_VERSION: '0.4.0' },
        differs: 'env:CLAUDE_AGENT_SDK_VERSION',
        hidden: ['0.3.319', '0.4.0']
      }
    ]
    for (const { name, saved, now, env, before, differs, hidden } of cases) {
      writeFileSync(mcp, '{"mcpServers":{"a":{"command":"first-server"}}}')
      const claim = held(name, launch(saved), appEnv('1.4.0', name))
      // The record as the earlier instance left it on disk.
      mkdirSync(claim.recordDir, { recursive: true })
      writeFileSync(claim.recordPath, '{}')
      before?.()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const base = recordingSpawner()
      const spawn = forkChatSurviveSpawner(base.spawn, 'darwin', {
        ...appEnv('1.5.0', name),
        ...env
      })
      try {
        expect(() => spawn(launch(now))).toThrow(/still stopping/)
        expect(base.specs).toEqual([])
        expect(claim.stop).toHaveBeenCalledTimes(1)
        // One line per refusal, with the names of what differs and none of the values.
        expect(warn).toHaveBeenCalledTimes(1)
        const line = String(warn.mock.calls[0]?.[0])
        expect(line).toContain(`chat ${name}`)
        expect(line).toContain(`launch differs in: ${differs}`)
        for (const value of [...hidden, 'secret-token', 'token-of-1.4.0', '1.5.0']) {
          expect(line).not.toContain(value)
        }
      } finally {
        warn.mockRestore()
      }
      // The stopped broker's record goes with it, not at the next app start.
      await vi.waitFor(() => expect(existsSync(claim.recordPath)).toBe(false))
      expect(chatSurviveClaimStopping(name)).toBe(false)
    }
  })

  it('refuses a claim whose record has no fingerprint in this format', () => {
    const claim = held('old', { program: 'claude', args: [] }, appEnv('1.4.0', 'old'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const spawn = forkChatSurviveSpawner(recordingSpawner().spawn, 'darwin', appEnv('1.4.0', 'old'))
    try {
      expect(() => spawn(launch(MODEL))).toThrow(/still stopping/)
      expect(claim.stop).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain('no launch fingerprint to compare')
    } finally {
      warn.mockRestore()
    }
  })
})

describe.runIf(process.platform !== 'win32')('Claude under a chat-survive broker', () => {
  // Real processes: tsx compiles the owner and broker on first start, which can take seconds.
  it('closes through the broker with the same exit proof as today', async () => {
    const recordDir = join(tempDir(), 'chat-survive')
    enable(recordDir)
    // The test runs the broker entry from source, so Node needs the tsx loader in front of it.
    const spawner = createClaudeCodeProcessSpawn((spec) =>
      spawnProcess(
        spec.args?.[0] === ENTRY ? { ...spec, args: ['--import', tsxLoader, ...spec.args] } : spec
      )
    )
    const options: SdkSpawnOptions = {
      command: process.execPath,
      args: ['-e', FAKE_CLAUDE],
      cwd: tempDir(),
      env: { ...process.env, ORCA_AGENT_SESSION_ID: 'sess' },
      signal: new AbortController().signal
    }
    const child = spawner.spawn(options)
    const managed = spawner.managed
    if (!managed || child.pid === undefined) {
      throw new Error('no managed child')
    }
    pids.add(child.pid)
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    await vi.waitFor(() => expect(out).toContain('\n'), { timeout: 15_000, interval: 20 })
    const claude = Number(/"claude":(\d+)/.exec(out)?.[1])
    pids.add(claude)
    expect(claude).not.toBe(child.pid)
    expect(readdirSync(recordDir)).toEqual([`sess.${child.pid}.json`])

    await expect(proveClaudeChildExit({ managed })).resolves.toBe(true)
    expect(managed.lastCloseResult).toEqual({ root: 'exited', tree: 'exited' })
    expect(alive(claude)).toBe(false)
    await vi.waitFor(() => expect(readdirSync(recordDir)).toEqual([]), {
      timeout: 5000,
      interval: 20
    })
  }, 30_000)
})
