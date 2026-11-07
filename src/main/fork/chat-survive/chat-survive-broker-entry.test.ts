import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProviderSpawnSpec } from '../../provider-process/provider-process-supervisor'
import {
  CHAT_SURVIVE_SPEC_ENV,
  encodeChatSurviveBrokerSpec,
  parseChatSurviveBrokerSpec,
  supervisorEnvOwnedBy
} from './chat-survive-broker-spec'
import { ChatSurviveRefusedError, connectChatSurviveBroker } from './chat-survive-client'
import {
  chatSurviveSocketDir,
  isProviderSupervisorSpawn,
  planChatSurviveBrokerSpawn
} from './chat-survive-launch'

const TOKEN = 'a'.repeat(64)
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href
const FIXTURE = join(import.meta.dirname, 'chat-survive-owner.test-fixture.ts')

// Says its pid, then echoes each stdin line; it exits by itself when stdin ends.
const PROVIDER = `
process.stderr.write('pid ' + process.pid + '\\n')
const rl = require('node:readline').createInterface({ input: process.stdin })
rl.on('line', (line) => process.stdout.write('echo:' + line + '\\n'))
`

function supervisorSpawn() {
  const spec = createProviderSpawnSpec(
    { command: process.execPath, args: ['-e', PROVIDER] },
    process.env,
    'darwin'
  )
  return { program: spec.program, args: spec.args, env: spec.env, cwd: spec.cwd, detached: true }
}

function decodeSupervisorOwner(env: NodeJS.ProcessEnv): unknown {
  const raw = env.ORCA_PROVIDER_SUPERVISOR_SPEC ?? ''
  const spec: unknown = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
  return typeof spec === 'object' && spec !== null && 'ownerPid' in spec ? spec.ownerPid : null
}

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
  const dir = mkdtempSync(join(tmpdir(), 'cs-'))
  dirs.push(dir)
  return dir
}

function waitFor(check: () => boolean, timeout = 8000): Promise<void> {
  return vi.waitFor(() => expect(check()).toBe(true), { timeout, interval: 20 })
}

type Chain = {
  owner: ChildProcess
  out: () => string
  err: () => string
  broker: { brokerPid: number; socketPath: string; token: string }
  providerPid: number
}

function isIdentity(value: unknown): value is Chain['broker'] {
  return (
    typeof value === 'object' &&
    value !== null &&
    'brokerPid' in value &&
    typeof value.brokerPid === 'number' &&
    'socketPath' in value &&
    typeof value.socketPath === 'string' &&
    'token' in value &&
    typeof value.token === 'string'
  )
}

async function startChain(): Promise<Chain> {
  const owner = spawn(process.execPath, ['--import', tsxLoader, FIXTURE], {
    env: { ...process.env, FIXTURE_PROVIDER: PROVIDER, FIXTURE_SOCKET_BASE: tempDir() },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  if (owner.pid) {
    pids.add(owner.pid)
  }
  let out = ''
  let err = ''
  owner.stdout?.on('data', (chunk: Buffer) => {
    out += chunk.toString('utf8')
  })
  owner.stderr?.on('data', (chunk: Buffer) => {
    err += chunk.toString('utf8')
  })
  await waitFor(() => /pid \d+/.test(err), 15_000)
  const identity: unknown = JSON.parse(err.split('\n')[0] ?? '')
  if (!isIdentity(identity)) {
    throw new Error(`no broker identity: ${err}`)
  }
  const providerPid = Number(/pid (\d+)/.exec(err)?.[1])
  pids.add(identity.brokerPid)
  pids.add(providerPid)
  return { owner, out: () => out, err: () => err, broker: identity, providerPid }
}

describe('chat-survive broker spec', () => {
  it('round-trips and refuses anything short of a full spec', () => {
    const spec = {
      v: 1 as const,
      socketPath: '/tmp/x.sock',
      token: TOKEN,
      ownerPid: 42,
      orphanTimeoutMs: 1000
    }
    expect(parseChatSurviveBrokerSpec(encodeChatSurviveBrokerSpec(spec))).toEqual(spec)
    expect(parseChatSurviveBrokerSpec(undefined)).toBeNull()
    expect(parseChatSurviveBrokerSpec('not base64 json')).toBeNull()
    for (const bad of [
      { ...spec, v: 2 },
      { ...spec, token: 'short' },
      { ...spec, ownerPid: 0 },
      { ...spec, orphanTimeoutMs: 1.5 },
      { ...spec, socketPath: '' }
    ]) {
      expect(parseChatSurviveBrokerSpec(Buffer.from(JSON.stringify(bad)).toString('base64'))).toBe(
        null
      )
    }
  })

  it('hands the supervisor to the broker and leaves the rest of its spec alone', () => {
    const { env } = supervisorSpawn()
    expect(decodeSupervisorOwner(env)).toBe(process.pid)
    const owned = supervisorEnvOwnedBy(env, 4242)
    expect(owned && decodeSupervisorOwner(owned)).toBe(4242)
    expect(owned?.ELECTRON_RUN_AS_NODE).toBe(env.ELECTRON_RUN_AS_NODE)
    expect(supervisorEnvOwnedBy({}, 4242)).toBeNull()
    expect(supervisorEnvOwnedBy({ ORCA_PROVIDER_SUPERVISOR_SPEC: 'e30=' }, 4242)).toBeNull()
  })
})

describe('chat-survive launch plan', () => {
  it('wraps only a provider supervisor spawn', () => {
    const supervisor = supervisorSpawn()
    expect(isProviderSupervisorSpawn(supervisor)).toBe(true)
    expect(isProviderSupervisorSpawn({ args: [] })).toBe(false)
    const dir = tempDir()
    expect(
      planChatSurviveBrokerSpawn(
        { program: 'claude', args: ['--print'] },
        { entryPath: '/e.js', socketDir: dir }
      )
    ).toBeNull()
    expect(planChatSurviveBrokerSpawn(supervisor, { entryPath: '/e.js', socketDir: null })).toBe(
      null
    )
    expect(
      planChatSurviveBrokerSpawn(supervisor, {
        entryPath: '/e.js',
        socketDir: `/${'x'.repeat(90)}`
      })
    ).toBeNull()

    const plan = planChatSurviveBrokerSpawn(supervisor, {
      entryPath: '/e.js',
      socketDir: dir,
      ownerPid: 77,
      execPath: '/electron'
    })
    expect(plan?.spawn.program).toBe('/electron')
    expect(plan?.spawn.args).toEqual(['/e.js', '--', supervisor.program, ...supervisor.args])
    expect(plan?.spawn.detached).toBe(true)
    expect(plan?.spawn.env?.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(plan?.token).toMatch(/^[0-9a-f]{64}$/)
    expect(plan?.socketPath.startsWith(`${dir}/`)).toBe(true)
    const spec = parseChatSurviveBrokerSpec(plan?.spawn.env?.[CHAT_SURVIVE_SPEC_ENV])
    expect(spec).toMatchObject({ ownerPid: 77, token: plan?.token, socketPath: plan?.socketPath })
  })

  it('uses a socket folder only when it is private', () => {
    const base = tempDir()
    const dir = chatSurviveSocketDir(base)
    expect(dir).toBe(join(base, 'orca-chat-survive'))
    chmodSync(join(base, 'orca-chat-survive'), 0o755)
    expect(chatSurviveSocketDir(base)).toBeNull()
  })
})

describe('chat-survive broker process', () => {
  // Real processes: tsx compiles the owner and broker on first start, which can take seconds.
  it('is a transparent pipe while the app lives and ends with the provider', async () => {
    const chain = await startChain()
    chain.owner.stdin?.write('hi\n')
    await waitFor(() => chain.out().includes('echo:hi'))
    // A second app instance cannot attach while this one holds the chat.
    await expect(
      connectChatSurviveBroker({
        socketPath: chain.broker.socketPath,
        token: chain.broker.token,
        fence: 9
      })
    ).rejects.toThrow(ChatSurviveRefusedError)
    chain.owner.stdin?.end()
    await waitFor(() => chain.err().includes('exit 0 null'))
    expect(alive(chain.providerPid)).toBe(false)
  }, 30_000)

  // Real processes: tsx compiles the owner and broker on first start, which can take seconds.
  it('stops the provider on a stop signal and reports it as the exit', async () => {
    const chain = await startChain()
    process.kill(chain.broker.brokerPid, 'SIGTERM')
    await waitFor(() => /exit \S+ \S+/.test(chain.err()))
    expect(chain.err()).not.toContain('exit 0 null')
    expect(alive(chain.providerPid)).toBe(false)
  }, 30_000)

  // Real processes: tsx compiles the owner and broker on first start, which can take seconds.
  it('keeps the provider when the app dies and lets the next app take it over', async () => {
    const chain = await startChain()
    chain.owner.stdin?.write('before\n')
    await waitFor(() => chain.out().includes('echo:before'))
    chain.owner.kill('SIGKILL')
    // The broker notices within its owner poll and opens the chat to a new owner.
    const connection = await vi.waitFor(
      () =>
        connectChatSurviveBroker({
          socketPath: chain.broker.socketPath,
          token: chain.broker.token,
          fence: 1
        }),
      { timeout: 8000, interval: 50 }
    )
    let text = ''
    connection.stdout.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8')
    })
    await waitFor(() => text.includes('echo:before'))
    expect(alive(chain.providerPid)).toBe(true)
    connection.write('after\n')
    await waitFor(() => text.includes('echo:after'))
    connection.endInput()
    await connection.exited
    expect(alive(chain.providerPid)).toBe(false)
    // The broker keeps the exit for a reattach until the owner lets it go.
    connection.release()
    await waitFor(() => !alive(chain.providerPid) && !alive(chain.broker.brokerPid))
  }, 30_000)

  // Real processes: tsx compiles the owner and broker on first start, which can take seconds.
  it('lets the app that spawned it move to the socket and leave the provider running', async () => {
    const chain = await startChain()
    chain.owner.stdin?.write('before\n')
    await waitFor(() => chain.out().includes('echo:before'))
    const socket = { socketPath: chain.broker.socketPath, token: chain.broker.token }
    const quitting = await connectChatSurviveBroker({ ...socket, fence: 4, takeover: true })
    // The old stdio is cut off: its input and its end no longer reach the provider.
    chain.owner.stdin?.write('ignored\n')
    chain.owner.stdin?.end()
    await expect(connectChatSurviveBroker({ ...socket, fence: 3 })).rejects.toThrow(
      ChatSurviveRefusedError
    )
    quitting.detach()
    const next = await connectChatSurviveBroker({ ...socket, fence: 5 })
    let text = ''
    next.stdout.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8')
    })
    next.write('after\n')
    await waitFor(() => text.includes('echo:after'))
    expect(text).not.toContain('echo:ignored')
    expect(alive(chain.providerPid)).toBe(true)
    next.stop()
    await waitFor(() => !alive(chain.providerPid) && !alive(chain.broker.brokerPid))
  }, 30_000)

  // Real processes: tsx compiles the owner and broker on first start, which can take seconds.
  it('takes the provider down with it when the broker itself dies', async () => {
    const chain = await startChain()
    process.kill(chain.broker.brokerPid, 'SIGKILL')
    await waitFor(() => !alive(chain.providerPid))
  }, 30_000)
})
