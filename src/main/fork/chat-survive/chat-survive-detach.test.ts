import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpawnOptions as SdkSpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { spawnProcess } from '@orca/process-host'
import type { PipedChildProcess } from '@orca/process-host/process-spec'
import { proveClaudeChildExit } from '../../claude/claude-agent-sdk-exit-proof'
import { createClaudeCodeProcessSpawn } from '../../claude/claude-agent-sdk-process-spawn'
import { connectChatSurviveBroker } from './chat-survive-client'
import {
  chatSurviveWillSurvive,
  detachChatSurvive,
  forkChatSurviveQuit
} from './chat-survive-detach'
import { forkChatSurviveConsumed } from './chat-survive-registry'
import { setChatSurviveConfigReader } from './chat-survive-spawn'
import { createChatSurviveStreamTracker } from './chat-survive-stream-mark'

const ENTRY = join(import.meta.dirname, 'chat-survive-broker-entry.ts')
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href

// Asks for two permissions, then echoes each input line it gets as {"echo": ...}. Messages carry
// a uuid, as Claude Code's do, so a test can mark them consumed.
const FAKE_CLAUDE = `
const { randomUUID } = require('node:crypto')
const say = (frame) => process.stdout.write(JSON.stringify(frame) + '\\n')
say({ type: 'system', claude: process.pid, uuid: randomUUID() })
say({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool' } })
say({ type: 'control_request', request_id: 'r2', request: { subtype: 'can_use_tool' } })
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => say({ echo: line, uuid: randomUUID() }))
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
  const dir = mkdtempSync(join(tmpdir(), 'csd-'))
  dirs.push(dir)
  return dir
}

/** What the app's reader does with each message: hands it on, which moves the replay mark. */
function consume(child: PipedChildProcess, out: string): void {
  const lines = out.split('\n')
  for (const line of lines) {
    const uuid = /"uuid":"([^"]+)"/.exec(line)?.[1]
    if (uuid) {
      forkChatSurviveConsumed(child, { uuid })
    }
  }
}

function waitFor(check: () => boolean, timeout = 8000): Promise<void> {
  return vi.waitFor(() => expect(check()).toBe(true), { timeout, interval: 20 })
}

function readRecord(dir: string): { socketPath: string; token: string } {
  const [name] = readdirSync(dir)
  const record: unknown = JSON.parse(readFileSync(join(dir, name ?? ''), 'utf8'))
  if (
    typeof record !== 'object' ||
    record === null ||
    !('socketPath' in record) ||
    typeof record.socketPath !== 'string' ||
    !('token' in record) ||
    typeof record.token !== 'string'
  ) {
    throw new Error('no record')
  }
  return { ...record, socketPath: record.socketPath, token: record.token }
}

describe('chat-survive stream mark', () => {
  it('moves past consumed messages and holds back unanswered control requests', () => {
    const tracker = createChatSurviveStreamTracker()
    const first = '{"type":"assistant","uuid":"11111111-0001"}\n'
    const request = '{"type":"control_request","request_id":"a","request":{}}\n'
    const second = '{"type":"control_request","request_id":"b"}\n'
    const third = '{"type":"user","message":{"uuid":"x"},"uuid":"11111111-0002"}\n'
    tracker.stdout(first)
    // A request split across chunks still counts from its own first byte.
    tracker.stdout(Buffer.from(request.slice(0, 10)))
    tracker.stdout(Buffer.from(`${request.slice(10)}${second}${third}`))
    tracker.stdout('{"partial":')
    tracker.stderr('oops\n')
    const delivered = Buffer.byteLength(`${first}${request}${second}${third}`)
    // Read is not consumed: every message comes again until the app hands it on.
    expect(tracker.mark()).toEqual({ out: 0, err: 5, seen: 0, delivered, pending: ['a', 'b'] })
    tracker.consumed('99999999-0000')
    expect(tracker.mark().seen).toBe(0)
    tracker.consumed('11111111-0001')
    expect(tracker.mark()).toMatchObject({
      out: Buffer.byteLength(first),
      seen: Buffer.byteLength(first)
    })
    tracker.consumed('11111111-0002')
    expect(tracker.mark()).toMatchObject({ out: Buffer.byteLength(first), seen: delivered })
    tracker.stdin('{"type":"control_response","response":{"subtype":"success","request_id":"a"}}\n')
    tracker.stdout('1}\n{"type":"control_cancel_request","request_id":"b"}\n')
    expect(tracker.mark().pending).toEqual([])
    expect(tracker.mark().out).toBe(delivered)
  })
})

describe.runIf(process.platform === 'darwin')('chat-survive quit hook', () => {
  function startClaude(enabled: () => boolean) {
    const recordDir = join(tempDir(), 'chat-survive')
    setChatSurviveConfigReader(() => ({ enabled: enabled(), recordDir, entryPath: ENTRY }))
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
    return { recordDir, child, managed, out: () => out }
  }

  // Real processes: tsx compiles the broker on first start, which can take seconds.
  it('hands a live chat to its broker with the replay mark, and nothing here stops it', async () => {
    const { recordDir, child, managed, out } = startClaude(() => true)
    await waitFor(() => out().includes('"r2"'), 15_000)
    const claude = Number(/"claude":(\d+)/.exec(out())?.[1])
    pids.add(claude)
    child.stdin.write('{"type":"control_response","response":{"request_id":"r2"}}\n')
    await waitFor(() => out().includes('"echo"'))
    consume(child, out())
    expect(chatSurviveWillSurvive('sess')).toBe(true)
    await expect(forkChatSurviveQuit('sess', { phase: 'starting', fence: 3 })).resolves.toBe(false)

    await expect(forkChatSurviveQuit('sess', { phase: 'ready', fence: 3 })).resolves.toBe(true)
    expect(chatSurviveWillSurvive('sess')).toBe(false)
    await expect(detachChatSurvive('sess', 3)).resolves.toBe(false)
    // The app's whole close ladder now leaves the provider alone.
    expect(child.kill('SIGKILL')).toBe(false)
    await expect(proveClaudeChildExit({ managed })).resolves.toBe(false)
    await expect(managed.terminateTree()).resolves.toBe('live')
    expect(alive(child.pid ?? -1)).toBe(true)
    expect(alive(claude)).toBe(true)

    const record = readRecord(recordDir)
    const lines = out().split('\n')
    const r1Start = Buffer.byteLength(`${lines.slice(0, 1).join('\n')}\n`)
    expect(record).toMatchObject({
      sessionId: 'sess',
      brokerPid: child.pid,
      detached: {
        fence: 3,
        out: r1Start,
        seen: Buffer.byteLength(out()),
        delivered: Buffer.byteLength(out()),
        pending: ['r1']
      }
    })

    // The next app instance picks up from the mark with a higher fence.
    const next = await connectChatSurviveBroker({
      socketPath: record.socketPath,
      token: record.token,
      fence: 4,
      from: { out: r1Start, err: 0 }
    })
    let replay = ''
    next.stdout.on('data', (chunk: Buffer) => {
      replay += chunk.toString('utf8')
    })
    await waitFor(() => replay.includes('"echo"'))
    expect(replay.startsWith('{"type":"control_request","request_id":"r1"')).toBe(true)
    next.stop()
    await waitFor(() => !alive(claude) && !alive(child.pid ?? -1))
  }, 30_000)

  // Real processes: tsx compiles the broker on first start, which can take seconds.
  it('stops as today when the setting went off or the chat is unknown', async () => {
    let enabled = true
    const { child, managed, out } = startClaude(() => enabled)
    await waitFor(() => out().includes('"r2"'), 15_000)
    pids.add(Number(/"claude":(\d+)/.exec(out())?.[1]))
    await expect(detachChatSurvive('other', 1)).resolves.toBe(false)
    enabled = false
    expect(chatSurviveWillSurvive('sess')).toBe(false)
    await expect(detachChatSurvive('sess', 1)).resolves.toBe(false)
    await expect(proveClaudeChildExit({ managed })).resolves.toBe(true)
    expect(alive(child.pid ?? -1)).toBe(false)
  }, 30_000)
})
