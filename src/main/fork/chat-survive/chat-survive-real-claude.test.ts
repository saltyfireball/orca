// SLRM-1394 end to end against the real Claude Code CLI, so it costs a (Haiku) turn and needs the
// user's login: it runs only with ORCA_CHAT_SURVIVE_E2E=1, on darwin. Each stand-in app instance is
// a child process (chat-survive-real-claude.test-fixture.ts) that is SIGKILLed after its quit hook.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const FIXTURE = join(import.meta.dirname, 'chat-survive-real-claude.test-fixture.ts')
const CLAUDE =
  process.env.ORCA_CHAT_SURVIVE_E2E_CLAUDE ?? join(process.env.HOME ?? '', '.local/bin/claude')
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href
// The host app's own session stamps and Claude Code's nesting markers must not reach the chat.
const HOST_ENV = /^(?:ORCA_|CLAUDE_CODE_|CLAUDECODE$|CLAUDE_PID$|CLAUDE_EFFORT$|CLAUDE_AGENT_SDK_)/

type Owner = { child: ChildProcess; events: unknown[]; send: (line: string) => void }

const dirs: string[] = []
const owners: ChildProcess[] = []
const brokers = new Set<number>()

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function field(value: unknown, ...path: string[]): unknown {
  let current = value
  for (const key of path) {
    current =
      typeof current === 'object' && current !== null ? Reflect.get(current, key) : undefined
  }
  return current
}

afterEach(() => {
  // Only processes this test started, by their own pids. A broker stops its Claude on SIGTERM.
  for (const owner of owners.splice(0)) {
    if (owner.pid !== undefined && owner.exitCode === null && owner.signalCode === null) {
      process.kill(owner.pid, 'SIGKILL')
    }
  }
  for (const pid of brokers) {
    if (alive(pid)) {
      process.kill(pid, 'SIGTERM')
    }
  }
  brokers.clear()
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'csr-'))
  dirs.push(dir)
  return dir
}

function startOwner(args: string[]): Owner {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !HOST_ENV.test(key)))
  const debug = process.env.ORCA_CHAT_SURVIVE_E2E_DEBUG
  if (debug) {
    env.ORCA_CHAT_SURVIVE_E2E_DEBUG = debug
  }
  const child = spawn(process.execPath, ['--import', tsxLoader, FIXTURE, ...args], {
    env,
    stdio: ['pipe', 'pipe', 'inherit']
  })
  owners.push(child)
  const events: unknown[] = []
  let partial = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    const lines = (partial + chunk.toString('utf8')).split('\n')
    partial = lines.pop() ?? ''
    for (const line of lines) {
      events.push(JSON.parse(line))
    }
  })
  return { child, events, send: (line) => child.stdin?.write(`${line}\n`) }
}

function eventsOf(owner: Owner, ev: string): unknown[] {
  return owner.events.filter((event) => field(event, 'ev') === ev)
}

function messagesOf(owner: Owner, type: string): unknown[] {
  return eventsOf(owner, 'msg').filter((event) => field(event, 'message', 'type') === type)
}

function waitFor(check: () => boolean, timeout: number): Promise<void> {
  return vi.waitFor(() => expect(check()).toBe(true), { timeout, interval: 50 })
}

async function quitAndKill(owner: Owner, fence: number): Promise<void> {
  owner.send(`quit ${fence}`)
  await waitFor(() => eventsOf(owner, 'detached').length > 0, 10_000)
  expect(field(eventsOf(owner, 'detached')[0], 'ok')).toBe(true)
  const gone = new Promise((resolve) => owner.child.once('exit', resolve))
  // The app dies hard right after its quit hook; nothing of it runs after the hand-off.
  process.kill(owner.child.pid ?? -1, 'SIGKILL')
  await gone
}

async function adopt(sessionId: string, recordDir: string, cwd: string, brokerPid: number) {
  const owner = startOwner(['adopt', sessionId, recordDir, cwd, CLAUDE, String(brokerPid)])
  // A refused start (the launch check) shows as an error event, not as a timeout.
  await waitFor(() => eventsOf(owner, 'pid').length + eventsOf(owner, 'error').length > 0, 30_000)
  expect(eventsOf(owner, 'error')).toEqual([])
  expect(field(eventsOf(owner, 'adopted')[0], 'ok')).toBe(true)
  expect(field(eventsOf(owner, 'pid')[0], 'pid')).toBe(brokerPid)
  // Adopted although this launch resumes where the first started: the launch check allows that.
  expect(field(eventsOf(owner, 'pid')[0], 'args')).toEqual(
    expect.arrayContaining([expect.stringMatching(/^--resume=/)])
  )
  return owner
}

describe.runIf(process.env.ORCA_CHAT_SURVIVE_E2E === '1' && process.platform === 'darwin')(
  'chat-survive with the real Claude Code',
  () => {
    // A real model turn with a 15 s command in it, across two restarts.
    it('carries one turn across two hard restarts with every event delivered once', async () => {
      const sessionId = `csr-e2e-${process.pid}`
      const recordDir = join(tempDir(), 'chat-survive')
      const cwd = tempDir()
      const nonce = `done-${process.pid}`
      const prompt = `Use the Bash tool to run exactly this command: sleep 15 && touch marker && echo ${nonce}\nThen reply with only its output.`
      const all: Owner[] = []
      try {
        // First instance: the turn starts and stops at the Bash permission prompt, unanswered.
        const first = startOwner(['first', sessionId, recordDir, cwd, CLAUDE, prompt])
        all.push(first)
        await waitFor(() => eventsOf(first, 'pid').length > 0, 30_000)
        const brokerPid = Number(field(eventsOf(first, 'pid')[0], 'pid'))
        brokers.add(brokerPid)
        expect(field(eventsOf(first, 'pid')[0], 'args')).toEqual(
          expect.arrayContaining([expect.stringMatching(/^--session-id=/)])
        )
        await waitFor(() => eventsOf(first, 'perm').length > 0, 120_000)
        const toolUseID = field(eventsOf(first, 'perm')[0], 'toolUseID')
        await quitAndKill(first, 3)

        // Second instance: the prompt comes back once, is allowed, and the command starts.
        const second = await adopt(sessionId, recordDir, cwd, brokerPid)
        all.push(second)
        await waitFor(
          () =>
            messagesOf(second, 'system').some(
              (event) => field(event, 'message', 'subtype') === 'task_started'
            ),
          30_000
        )
        expect(eventsOf(second, 'perm').map((event) => field(event, 'toolUseID'))).toEqual([
          toolUseID
        ])
        await quitAndKill(second, 1)

        // Third instance, mid-command: the rest of the turn and its result arrive here.
        const third = await adopt(sessionId, recordDir, cwd, brokerPid)
        all.push(third)
        await waitFor(() => messagesOf(third, 'result').length > 0, 60_000)
        const [result] = messagesOf(third, 'result')
        expect(field(result, 'message', 'subtype')).toBe('success')
        expect(String(field(result, 'message', 'result'))).toContain(nonce)
        expect(eventsOf(third, 'perm')).toEqual([])
        expect(all.slice(0, 2).flatMap((owner) => messagesOf(owner, 'result'))).toEqual([])

        // Nothing is delivered twice, across all three instances.
        const uuids = all.flatMap((owner) =>
          eventsOf(owner, 'msg').map((event) => field(event, 'message', 'uuid'))
        )
        const present = uuids.filter((uuid) => typeof uuid === 'string')
        expect(new Set(present).size).toBe(present.length)
        const toolResults = all
          .flatMap((owner) => messagesOf(owner, 'user'))
          .filter((event) => {
            const text = JSON.stringify(event)
            return text.includes('"tool_result"') && text.includes(nonce)
          })
        expect(toolResults).toHaveLength(1)

        // Ending its input ends the chat as a pipe would, and leaves nothing behind.
        third.send('end')
        // Claude Code sometimes takes longer than the supervisor's 1 s stdin-end grace to shut down
        // (seen once, its claude.ai MCP connections closing), and is then stopped: exit 137. The
        // supervisor does the same to a chat that never moved, so either end is today's close.
        await waitFor(
          () =>
            eventsOf(third, 'done').length > 0 ||
            eventsOf(third, 'error').some((event) =>
              /code 137/.test(String(field(event, 'message')))
            ),
          30_000
        )
        await waitFor(() => !alive(brokerPid), 15_000)
        expect(readdirSync(recordDir)).toEqual([])
      } finally {
        const log = process.env.ORCA_CHAT_SURVIVE_E2E_LOG
        if (log) {
          writeFileSync(
            log,
            JSON.stringify(
              all.map((owner) => owner.events),
              null,
              1
            )
          )
        }
      }
    }, 300_000)
  }
)
