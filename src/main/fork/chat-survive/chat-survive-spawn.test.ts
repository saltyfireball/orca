import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpawnOptions as SdkSpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { spawnProcess } from '@orca/process-host'
import type { PipedChildProcess, PipedProcessSpec } from '@orca/process-host/process-spec'
import { createProviderSpawnSpec } from '../../provider-process/provider-process-supervisor'
import { proveClaudeChildExit } from '../../claude/claude-agent-sdk-exit-proof'
import { createClaudeCodeProcessSpawn } from '../../claude/claude-agent-sdk-process-spawn'
import { CHAT_SURVIVE_SPEC_ENV } from './chat-survive-broker-spec'
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

afterEach(() => {
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

function supervisorSpawn(): PipedProcessSpec {
  const spec = createProviderSpawnSpec(
    { command: process.execPath, args: ['-e', FAKE_CLAUDE] },
    process.env,
    'darwin'
  )
  return { program: spec.program, args: spec.args, env: spec.env, cwd: spec.cwd, detached: true }
}

function recordingSpawner(): {
  specs: PipedProcessSpec[]
  spawn: (spec: PipedProcessSpec) => PipedChildProcess
} {
  const specs: PipedProcessSpec[] = []
  return {
    specs,
    spawn: (spec) => {
      specs.push(spec)
      return spawnProcess({ program: 'true', stdio: ['pipe', 'pipe', 'pipe'] })
    }
  }
}

function enable(recordDir: string, entryPath: string = ENTRY, enabled = true): void {
  setChatSurviveConfigReader(() => ({ enabled, recordDir, entryPath }))
}

describe('chat-survive spawn hook', () => {
  it('spawns as today unless switched on for a supervisor spawn it can plan', () => {
    const supervisor = supervisorSpawn()
    const socketDir = (): string => tempDir()
    const cases: { setup: () => void; spec?: PipedProcessSpec; platform?: NodeJS.Platform }[] = [
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
      forkChatSurviveSpawner(base.spawn, platform ?? 'darwin', {}, socketDir)(input)
      expect(base.specs).toEqual([input])
    }
    enable(tempDir())
    const base = recordingSpawner()
    forkChatSurviveSpawner(base.spawn, 'darwin', {}, () => null)(supervisor)
    expect(base.specs).toEqual([supervisor])
  })

  it('runs the supervisor under a broker and keeps a private record until the broker exits', async () => {
    const recordDir = join(tempDir(), 'chat-survive')
    enable(recordDir)
    const supervisor = supervisorSpawn()
    const base = recordingSpawner()
    const child = forkChatSurviveSpawner(
      base.spawn,
      'linux',
      { ORCA_AGENT_SESSION_ID: 'abc-1' },
      () => tempDir()
    )(supervisor)
    const [spawned] = base.specs
    expect(spawned?.args).toEqual([ENTRY, '--', supervisor.program, ...(supervisor.args ?? [])])
    expect(spawned?.env?.[CHAT_SURVIVE_SPEC_ENV]).toBeTruthy()
    const name = `abc-1.${child.pid}.json`
    const path = join(recordDir, name)
    const record: unknown = JSON.parse(readFileSync(path, 'utf8'))
    expect(record).toMatchObject({ v: 1, sessionId: 'abc-1', brokerPid: child.pid })
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(recordDir).mode & 0o777).toBe(0o700)
    await vi.waitFor(() => expect(existsSync(path)).toBe(false), { timeout: 5000, interval: 20 })
  })

  it('names records only from plain session ids', () => {
    expect(chatSurviveRecordName({ ORCA_AGENT_SESSION_ID: 'a_B-9' }, 7)).toBe('a_B-9.7.json')
    expect(chatSurviveRecordName({ ORCA_AGENT_SESSION_ID: '../x' }, 7)).toBe('session.7.json')
    expect(chatSurviveRecordName({}, 7)).toBe('session.7.json')
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
