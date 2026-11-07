import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpawnOptions as SdkSpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { spawnProcess } from '@orca/process-host'
import { createClaudeCodeProcessSpawn } from '../../claude/claude-agent-sdk-process-spawn'
import { chatSurviveReplayFilter } from './chat-survive-adopted-child'
import { forkChatSurviveAdopt } from './chat-survive-adopt'
import { hasChatSurviveClaim } from './chat-survive-claims'
import { forkChatSurviveQuit } from './chat-survive-detach'
import { setChatSurviveConfigReader } from './chat-survive-spawn'
import { createChatSurviveStreamTracker } from './chat-survive-stream-mark'

const ENTRY = join(import.meta.dirname, 'chat-survive-broker-entry.ts')
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href

// Asks for two permissions, then echoes each input line it gets as {"echo": ...}.
const FAKE_CLAUDE = `
const say = (frame) => process.stdout.write(JSON.stringify(frame) + '\\n')
say({ type: 'system', claude: process.pid })
say({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool' } })
say({ type: 'control_request', request_id: 'r2', request: { subtype: 'can_use_tool' } })
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => say({ echo: line }))
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

function waitFor(check: () => boolean, timeout = 8000): Promise<void> {
  return vi.waitFor(() => expect(check()).toBe(true), { timeout, interval: 20 })
}

describe('chat-survive replay', () => {
  it('replays only still-pending requests below the mark, then everything', () => {
    const lines = [
      '{"type":"control_request","request_id":"a"}\n',
      '{"type":"assistant"}\n',
      '{"type":"control_request","request_id":"b"}\n',
      '{"type":"result"}\n'
    ]
    const seen = Buffer.byteLength(lines.slice(0, 3).join(''))
    const filter = chatSurviveReplayFilter({ out: 0, err: 0, seen, pending: ['a'] })
    let out = ''
    filter.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    const all = lines.join('')
    // Split mid-line, so a line below the mark spans chunks.
    filter.write(Buffer.from(all.slice(0, 30)))
    filter.write(Buffer.from(all.slice(30)))
    expect(out).toBe(`${lines[0]}${lines[3]}`)
  })

  it('continues a saved mark in the broker offsets', () => {
    const tracker = createChatSurviveStreamTracker({ out: 100, err: 7, seen: 200, pending: ['a'] })
    // Nothing replayed yet: the next mark is still the saved one.
    expect(tracker.mark()).toEqual({ out: 100, err: 7, seen: 200, pending: ['a'] })
    tracker.stdout(`${'{"type":"control_request","request_id":"x"}'.padEnd(49, ' ')}\n`)
    tracker.stdout(`${'{"type":"control_request","request_id":"a"}'.padEnd(149, ' ')}\n`)
    tracker.stdout('{"type":"assistant"}\n')
    // An answered request below the mark does not come back; the pending one keeps its place.
    expect(tracker.mark()).toMatchObject({ out: 150, seen: 321, pending: ['a'] })
  })
})

describe.runIf(process.platform === 'darwin')('chat-survive adoption', () => {
  function spawnClaude() {
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
    const first = spawnClaude()
    await waitFor(() => first.out().includes('"r2"'), 15_000)
    pids.add(Number(/"claude":(\d+)/.exec(first.out())?.[1]))
    first.child.stdin.write('{"type":"control_response","response":{"request_id":"r2"}}\n')
    await waitFor(() => first.out().includes('"echo"'))
    await expect(forkChatSurviveQuit('sess', { phase: 'ready', fence: 3 })).resolves.toBe(true)
    const brokerPid = first.child.pid ?? -1

    // The next instance: recovery claims the broker and the chat's start takes it.
    const adopt = { sessionId: 'sess', ownerPid: brokerPid, platform: 'darwin' as const }
    await expect(forkChatSurviveAdopt(adopt)).resolves.toBe(true)
    expect(hasChatSurviveClaim('sess')).toBe(true)
    const second = spawnClaude()
    expect(hasChatSurviveClaim('sess')).toBe(false)
    expect(second.child.pid).toBe(brokerPid)
    second.child.stdin.write('hello\n')
    await waitFor(() => second.out().includes('"echo":"hello"'))
    // The still-unanswered r1 comes again; nothing the first instance handled does.
    expect(second.out().startsWith('{"type":"control_request","request_id":"r1"')).toBe(true)
    expect(second.out()).not.toContain('"r2"')
    expect(second.out()).not.toContain('control_response')

    // A second restart works the same way, from the adopted child's own mark.
    await expect(forkChatSurviveQuit('sess', { phase: 'ready', fence: 1 })).resolves.toBe(true)
    await expect(forkChatSurviveAdopt(adopt)).resolves.toBe(true)
    const third = spawnClaude()
    expect(third.child.pid).toBe(brokerPid)
    await waitFor(() => third.out().includes('"r1"'))
    expect(third.out()).not.toContain('hello')

    const exited = new Promise((resolve) => third.child.once('exit', resolve))
    third.child.stdin.end()
    await exited
    expect(alive(brokerPid)).toBe(false)
    expect(readdirSync(recordDir)).toEqual([])
  }, 45_000)

  // Real processes: tsx compiles the broker on first start, which can take seconds.
  it('claims nothing it cannot prove, so recovery stops the owner as today', async () => {
    let enabled = true
    const recordDir = setup(() => enabled)
    const live = spawnClaude()
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
    writeFileSync(path, saved)
    enabled = false
    await expect(forkChatSurviveAdopt(adopt)).resolves.toBe(false)
    expect(hasChatSurviveClaim('sess')).toBe(false)
    expect(alive(brokerPid)).toBe(true)
  }, 30_000)
})
