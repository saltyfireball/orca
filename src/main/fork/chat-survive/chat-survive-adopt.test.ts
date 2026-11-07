import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpawnOptions as SdkSpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { spawnProcess } from '@orca/process-host'
import type { PipedChildProcess } from '@orca/process-host/process-spec'
import { createClaudeCodeProcessSpawn } from '../../claude/claude-agent-sdk-process-spawn'
import { chatSurviveRedeliveryFilter, chatSurviveReplayFilter } from './chat-survive-adopted-child'
import { forkChatSurviveAdopt } from './chat-survive-adopt'
import { hasChatSurviveClaim } from './chat-survive-claims'
import { forkChatSurviveQuit } from './chat-survive-detach'
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
  const dir = mkdtempSync(join(tmpdir(), 'csa-'))
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

describe('chat-survive replay', () => {
  it('replays pending requests, then unconsumed messages, then everything', () => {
    const lines = [
      '{"type":"control_request","request_id":"a"}\n',
      '{"type":"assistant"}\n',
      '{"type":"control_request","request_id":"b"}\n',
      '{"type":"result"}\n',
      '{"type":"control_response","response":{"request_id":"c"}}\n',
      '{"type":"control_response","response":{"request_id":"d"}}\n'
    ]
    const seen = Buffer.byteLength(lines.slice(0, 2).join(''))
    const delivered = Buffer.byteLength(lines.slice(0, 5).join(''))
    const filter = chatSurviveReplayFilter({ out: 0, err: 0, seen, delivered, pending: ['a'] })
    let out = ''
    filter.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    const all = lines.join('')
    // Split mid-line, so a line below the mark spans chunks.
    filter.write(Buffer.from(all.slice(0, 30)))
    filter.write(Buffer.from(all.slice(30)))
    expect(out).toBe(`${lines[0]}${lines[3]}${lines[5]}`)
  })

  it('drops replayed prompts from the CLI redelivery, so each is asked once', () => {
    const filter = chatSurviveRedeliveryFilter(['a'])
    const chunks: Buffer[] = []
    filter.on('data', (chunk: Buffer) => chunks.push(chunk))
    const reply = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'init',
        pending_permission_requests: [{ request_id: 'a' }, { request_id: 'b' }],
        pending_user_dialog_requests: [{ request_id: 'a' }]
      }
    }
    const later = `${JSON.stringify(reply)}\n`
    const text = `{"type":"control_request","request_id":"a"}\n${later}${later}`
    // Split inside the reply, and inside a multibyte character after it.
    const all = Buffer.from(`${text}{"x":"\u00e9"}\n`)
    filter.write(all.subarray(0, 70))
    filter.write(all.subarray(70, -4))
    filter.write(all.subarray(-4))
    const lines = Buffer.concat(chunks).toString('utf8').split('\n')
    expect(lines[0]).toBe('{"type":"control_request","request_id":"a"}')
    expect(JSON.parse(lines[1] ?? '').response).toMatchObject({
      pending_permission_requests: [{ request_id: 'b' }],
      pending_user_dialog_requests: []
    })
    // Only the first reply, to the new initialize, is rewritten.
    expect(lines[2]).toBe(JSON.stringify(reply))
    expect(lines[3]).toBe('{"x":"\u00e9"}')
  })

  it('continues a saved mark in the broker offsets', () => {
    const saved = { out: 100, err: 7, seen: 200, delivered: 300, pending: ['a'] }
    const tracker = createChatSurviveStreamTracker(saved)
    // Nothing replayed yet: the next mark is still the saved one.
    expect(tracker.mark()).toEqual(saved)
    tracker.stdout(`${'{"type":"control_request","request_id":"x"}'.padEnd(49, ' ')}\n`)
    tracker.stdout(`${'{"type":"control_request","request_id":"a"}'.padEnd(149, ' ')}\n`)
    const message = '{"type":"assistant","uuid":"22222222-0001"}\n'
    tracker.stdout(message)
    // An answered request below the mark does not come back; the pending one keeps its place.
    const end = 300 + Buffer.byteLength(message)
    expect(tracker.mark()).toMatchObject({ out: 150, seen: 200, delivered: end, pending: ['a'] })
    tracker.consumed('22222222-0001')
    expect(tracker.mark()).toMatchObject({ out: 150, seen: end })
  })
})

describe.runIf(process.platform === 'darwin')('chat-survive adoption', () => {
  // `extraArgs` stand in for launch flags; Node would take a real `--flag` as its own.
  function spawnClaude(cwd: string, extraArgs: string[] = []) {
    // The test runs the broker entry from source, so Node needs the tsx loader in front of it.
    const spawner = createClaudeCodeProcessSpawn((spec) =>
      spawnProcess(
        spec.args?.[0] === ENTRY ? { ...spec, args: ['--import', tsxLoader, ...spec.args] } : spec
      )
    )
    const options: SdkSpawnOptions = {
      command: process.execPath,
      args: ['-e', FAKE_CLAUDE, ...extraArgs],
      cwd,
      env: { ...process.env, ORCA_AGENT_SESSION_ID: 'sess' },
      signal: new AbortController().signal
    }
    const child = spawner.spawn(options)
    if (child.pid === undefined) {
      throw new Error('no child')
    }
    pids.add(child.pid)
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    return { child, out: () => out }
  }

  function setup(enabled: () => boolean = () => true): string {
    const recordDir = join(tempDir(), 'chat-survive')
    setChatSurviveConfigReader(() => ({ enabled: enabled(), recordDir, entryPath: ENTRY }))
    return recordDir
  }

  // Real processes: tsx compiles the broker on first start, which can take seconds.
  it('reattaches a handed-off chat at the next start, twice, and ends it as a pipe would', async () => {
    const recordDir = setup()
    const cwd = tempDir()
    const first = spawnClaude(cwd)
    await waitFor(() => first.out().includes('"r2"'), 15_000)
    pids.add(Number(/"claude":(\d+)/.exec(first.out())?.[1]))
    first.child.stdin.write('{"type":"control_response","response":{"request_id":"r2"}}\n')
    await waitFor(() => first.out().includes('"echo"'))
    consume(first.child, first.out())
    await expect(forkChatSurviveQuit('sess', { phase: 'ready', fence: 3 })).resolves.toBe(true)
    const brokerPid = first.child.pid ?? -1

    // The next instance: recovery claims the broker and the chat's start takes it.
    const adopt = { sessionId: 'sess', ownerPid: brokerPid, platform: 'darwin' as const }
    await expect(forkChatSurviveAdopt(adopt)).resolves.toBe(true)
    expect(hasChatSurviveClaim('sess')).toBe(true)
    const second = spawnClaude(cwd)
    expect(hasChatSurviveClaim('sess')).toBe(false)
    expect(second.child.pid).toBe(brokerPid)
    second.child.stdin.write('hello\nworld\n')
    await waitFor(() => second.out().includes('"echo":"world"'))
    // The app consumed hello but quit before it consumed world.
    consume(
      second.child,
      second
        .out()
        .split('\n')
        .find((line) => line.includes('hello')) ?? ''
    )
    // The still-unanswered r1 comes again; nothing the first instance handled does.
    expect(second.out().startsWith('{"type":"control_request","request_id":"r1"')).toBe(true)
    expect(second.out()).not.toContain('"r2"')
    expect(second.out()).not.toContain('control_response')

    // A second restart works the same way, from the adopted child's own mark.
    await expect(forkChatSurviveQuit('sess', { phase: 'ready', fence: 1 })).resolves.toBe(true)
    await expect(forkChatSurviveAdopt(adopt)).resolves.toBe(true)
    const third = spawnClaude(cwd)
    expect(third.child.pid).toBe(brokerPid)
    await waitFor(() => third.out().includes('"r1"') && third.out().includes('world'))
    expect(third.out()).not.toContain('hello')
    expect(third.out().split('"echo":"world"')).toHaveLength(2)

    const exited = new Promise((resolve) => third.child.once('exit', resolve))
    third.child.stdin.end()
    await exited
    expect(alive(brokerPid)).toBe(false)
    // Its pid may name another process now: nothing signals it any more.
    expect(third.child.kill('SIGTERM')).toBe(false)
    expect(readdirSync(recordDir)).toEqual([])
  }, 45_000)

  // Real processes: tsx compiles the broker on first start, which can take seconds.
  it('claims nothing it cannot prove, so recovery stops the owner as today', async () => {
    let enabled = true
    const recordDir = setup(() => enabled)
    const live = spawnClaude(tempDir())
    await waitFor(() => live.out().includes('"r2"'), 15_000)
    pids.add(Number(/"claude":(\d+)/.exec(live.out())?.[1]))
    const brokerPid = live.child.pid ?? -1
    const adopt = { sessionId: 'sess', ownerPid: brokerPid, platform: 'darwin' as const }
    // Not handed off: the record has no mark, and the broker still has its first owner.
    await expect(forkChatSurviveAdopt(adopt)).resolves.toBe(false)
    await expect(forkChatSurviveAdopt({ ...adopt, ownerPid: brokerPid + 1 })).resolves.toBe(false)
    await expect(forkChatSurviveAdopt({ ...adopt, platform: 'linux' })).resolves.toBe(false)
    await expect(forkChatSurviveQuit('sess', { phase: 'ready', fence: 3 })).resolves.toBe(true)
    // A record that names another session, or a forged token, is refused.
    const [name] = readdirSync(recordDir)
    const path = join(recordDir, name ?? '')
    const saved = readFileSync(path, 'utf8')
    writeFileSync(path, saved.replace('"sess"', '"other"'))
    await expect(forkChatSurviveAdopt(adopt)).resolves.toBe(false)
    writeFileSync(path, saved.replace(/"token":"[^"]+"/, '"token":"forged"'))
    await expect(forkChatSurviveAdopt(adopt)).resolves.toBe(false)
    // So is one that does not say what its provider was launched with.
    writeFileSync(path, saved.replace(/,"launch":"[0-9a-f]{64}"/, ''))
    await expect(forkChatSurviveAdopt(adopt)).resolves.toBe(false)
    writeFileSync(path, saved)
    enabled = false
    await expect(forkChatSurviveAdopt(adopt)).resolves.toBe(false)
    expect(hasChatSurviveClaim('sess')).toBe(false)
    expect(alive(brokerPid)).toBe(true)
  }, 30_000)

  // Real processes: tsx compiles the broker on first start, which can take seconds.
  it('stops a surviving provider launched otherwise than the next start would', async () => {
    setup()
    const cwd = tempDir()
    const first = spawnClaude(cwd, ['model-old'])
    await waitFor(() => first.out().includes('"r2"'), 15_000)
    pids.add(Number(/"claude":(\d+)/.exec(first.out())?.[1]))
    await expect(forkChatSurviveQuit('sess', { phase: 'ready', fence: 3 })).resolves.toBe(true)
    const brokerPid = first.child.pid ?? -1
    const adopt = { sessionId: 'sess', ownerPid: brokerPid, platform: 'darwin' as const }
    await expect(forkChatSurviveAdopt(adopt)).resolves.toBe(true)
    // Another model: the start is refused while the old provider stops, then spawns as today.
    expect(() => spawnClaude(cwd, ['model-new'])).toThrow('still stopping')
    expect(hasChatSurviveClaim('sess')).toBe(false)
    await waitFor(() => !alive(brokerPid))
    await waitFor(() => {
      try {
        return spawnClaude(cwd, ['model-new']).child.pid !== brokerPid
      } catch {
        return false
      }
    })
  }, 30_000)
})
