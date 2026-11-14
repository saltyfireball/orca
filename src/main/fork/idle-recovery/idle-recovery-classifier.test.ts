// Idle recovery (FORK.md): the classifier command runner, against small node scripts written
// to a temp dir. No model, no network.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  IDLE_RECOVERY_MESSAGE_TAIL_CHARS,
  type IdleRecoveryClassifierInput
} from '../../../shared/fork/idle-recovery'
import {
  readIdleRecoverySettings,
  type IdleRecoverySettings
} from '../../../shared/fork/idle-recovery-settings'
import {
  IDLE_RECOVERY_CLASSIFIER_MAX_STDOUT_BYTES,
  classifyIdleRecoveryEnding
} from './idle-recovery-classifier'

const CHAT_TEXT = 'chat-text-that-must-not-be-logged'
const STALLED = {
  verdict: 'stalled',
  reason: 'it promised a next step',
  question: '',
  next_step: 'run the tests',
  wake_after_seconds: 5
}

let dir = ''
const startedPids: number[] = []

function script(name: string, body: string): string {
  const file = path.join(dir, name)
  writeFileSync(file, body)
  return `"${process.execPath}" "${file}"`
}

function settingsFor(command: string | undefined, extra: Record<string, unknown> = {}) {
  return readIdleRecoverySettings({
    forkIdleSweepMode: 'wake',
    forkIdleSweepClassifierCommand: command,
    forkIdleSweepClassifierTimeoutSeconds: 20,
    ...extra
  })
}

function input(message = `I will run the tests next. ${CHAT_TEXT}`): IdleRecoveryClassifierInput {
  return {
    version: 1,
    chat: { id: 'chat-1', kind: 'chat', agent: 'claude', cwd: '/work', title: 'A chat' },
    request_source: 'user',
    role: 'standalone',
    last_user_request: `Fix the bug. ${CHAT_TEXT}`,
    last_assistant_message: message,
    idle_seconds: 60,
    background_pending: false,
    scheduled_wake: false,
    wakes_this_turn: 0,
    max_wakes: 2
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The pid a fake classifier wrote for itself, remembered so a failed test cannot leak it. */
async function pidFrom(file: string): Promise<number> {
  await vi.waitFor(() => expect(existsSync(file)).toBe(true), { timeout: 10_000 })
  const pid = Number(readFileSync(file, 'utf8'))
  startedPids.push(pid)
  return pid
}

async function expectStopped(pid: number): Promise<void> {
  await vi.waitFor(() => expect(isAlive(pid)).toBe(false), { timeout: 10_000, interval: 50 })
}

/** A script that records its pid, then does `then` (which keeps it running). */
function lingering(name: string, then: string): { command: string; pidFile: string } {
  const pidFile = path.join(dir, `${name}.pid`)
  const body = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))\n${then}\n`
  return { command: script(`${name}.js`, body), pidFile }
}

const print = (value: unknown): string =>
  `process.stdout.write(${JSON.stringify(JSON.stringify(value))})\n`

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'idle-recovery-classifier-'))
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(() => {
  for (const pid of startedPids) {
    if (isAlive(pid)) {
      process.kill(pid, 'SIGKILL')
    }
  }
  rmSync(dir, { recursive: true, force: true })
})

describe('classifyIdleRecoveryEnding with a command', () => {
  it('returns the verdict the command prints', async () => {
    const verdict = await classifyIdleRecoveryEnding(
      input(),
      settingsFor(script('good.js', print(STALLED)))
    )
    expect(verdict).toEqual({
      verdict: 'stalled',
      reason: 'it promised a next step',
      question: '',
      nextStep: 'run the tests',
      wakeAfterSeconds: 5
    })
  })

  it('caps the wait a verdict asks for at the recheck setting', async () => {
    const verdict = await classifyIdleRecoveryEnding(
      input(),
      settingsFor(script('long-wait.js', print({ ...STALLED, wake_after_seconds: 999_999 })), {
        forkIdleSweepRecheckMaxMinutes: 2
      })
    )
    expect(verdict.wakeAfterSeconds).toBe(120)
  })

  it('gives the command the v1 input as one JSON object on stdin, message tail only', async () => {
    const seen = path.join(dir, 'seen.json')
    const command = script(
      'echo-input.js',
      `let text = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { text += chunk })
process.stdin.on('end', () => {
  require('node:fs').writeFileSync(${JSON.stringify(seen)}, text)
  const got = JSON.parse(text)
  process.stdout.write(JSON.stringify({
    verdict: 'waiting_user', reason: 'read ' + got.version, question: got.chat.title,
    next_step: '', wake_after_seconds: 0
  }))
})
`
    )
    const long = `${'a'.repeat(IDLE_RECOVERY_MESSAGE_TAIL_CHARS)}the end?`
    const verdict = await classifyIdleRecoveryEnding(input(long), settingsFor(command))
    expect(verdict).toMatchObject({ verdict: 'waiting_user', reason: 'read 1', question: 'A chat' })
    const got = JSON.parse(readFileSync(seen, 'utf8'))
    expect(got).toEqual({
      ...input(long),
      last_assistant_message: long.slice(-IDLE_RECOVERY_MESSAGE_TAIL_CHARS)
    })
  })

  it('runs the command as a shell line, so a pipe works', async () => {
    const relay = script(
      'relay.js',
      `process.stdin.on('data', (chunk) => process.stdout.write(chunk))\n`
    )
    const verdict = await classifyIdleRecoveryEnding(
      input(),
      settingsFor(`${script('piped.js', print(STALLED))} | ${relay}`)
    )
    expect(verdict.verdict).toBe('stalled')
  })

  it('says finished when the output is not a verdict', async () => {
    const notJson = await classifyIdleRecoveryEnding(
      input(),
      settingsFor(script('bad-json.js', `process.stdout.write('stalled, wake it {')\n`))
    )
    expect(notJson).toMatchObject({ verdict: 'finished', reason: 'classifier output was not JSON' })
    const wrongShape = await classifyIdleRecoveryEnding(
      input(),
      settingsFor(script('wrong-shape.js', print({ verdict: 'stalled' })))
    )
    expect(wrongShape.verdict).toBe('finished')
    const silent = await classifyIdleRecoveryEnding(input(), settingsFor(script('silent.js', '')))
    expect(silent.verdict).toBe('finished')
  })

  it('says finished on a non-zero exit, even with a stalled verdict printed', async () => {
    const command = script(
      'exit-3.js',
      `process.stdout.write(${JSON.stringify(JSON.stringify(STALLED))}, () => process.exit(3))\n`
    )
    const verdict = await classifyIdleRecoveryEnding(input(), settingsFor(command))
    expect(verdict).toEqual({
      verdict: 'finished',
      reason: 'classifier command failed',
      question: '',
      nextStep: '',
      wakeAfterSeconds: 0
    })
  })

  it('says finished when the command does not exist', async () => {
    const verdict = await classifyIdleRecoveryEnding(
      input(),
      settingsFor(`"${path.join(dir, 'no-such-classifier')}"`)
    )
    expect(verdict).toMatchObject({ verdict: 'finished', reason: 'classifier command failed' })
  })

  it('stops a slow command at the timeout and says finished', async () => {
    const slow = lingering('slow', 'setInterval(() => {}, 1000)')
    const verdict = await classifyIdleRecoveryEnding(
      input(),
      settingsFor(slow.command, { forkIdleSweepClassifierTimeoutSeconds: 1 })
    )
    // The reason says the timeout ended it, and the process is checked gone below.
    expect(verdict).toMatchObject({ verdict: 'finished', reason: 'classifier command timed out' })
    await expectStopped(await pidFrom(slow.pidFile))
  })

  it('stops a command that prints too much and says finished', async () => {
    const huge = lingering(
      'huge',
      `const block = 'x'.repeat(65536)
const more = () => { while (process.stdout.write(block)) {} }
process.stdout.on('drain', more)
more()`
    )
    const verdict = await classifyIdleRecoveryEnding(input(), settingsFor(huge.command))
    expect(verdict).toMatchObject({
      verdict: 'finished',
      reason: 'classifier output was too large'
    })
    await expectStopped(await pidFrom(huge.pidFile))
  })

  it('takes output up to the size cap', async () => {
    const padding = ' '.repeat(IDLE_RECOVERY_CLASSIFIER_MAX_STDOUT_BYTES - 1000)
    const command = script(
      'padded.js',
      `process.stdout.write(${JSON.stringify(JSON.stringify(STALLED))} + ${JSON.stringify(padding)})\n`
    )
    expect((await classifyIdleRecoveryEnding(input(), settingsFor(command))).verdict).toBe(
      'stalled'
    )
  })

  it('stops the command when the signal aborts', async () => {
    const waiting = lingering('aborted', 'setInterval(() => {}, 1000)')
    const controller = new AbortController()
    const pending = classifyIdleRecoveryEnding(
      input(),
      settingsFor(waiting.command),
      controller.signal
    )
    const pid = await pidFrom(waiting.pidFile)
    controller.abort()
    expect(await pending).toMatchObject({ verdict: 'finished', reason: 'classifier was cancelled' })
    await expectStopped(pid)
  })

  it('starts nothing when the signal is already aborted', async () => {
    const marker = lingering('never-started', '')
    const verdict = await classifyIdleRecoveryEnding(
      input(),
      settingsFor(marker.command),
      AbortSignal.abort()
    )
    expect(verdict).toMatchObject({ verdict: 'finished', reason: 'classifier was cancelled' })
    expect(existsSync(marker.pidFile)).toBe(false)
  })

  it('starts nothing while idle recovery is off', async () => {
    const marker = lingering('off', print(STALLED))
    const verdict = await classifyIdleRecoveryEnding(
      input(),
      settingsFor(marker.command, { forkIdleSweepMode: 'off' })
    )
    expect(verdict.verdict).toBe('finished')
    expect(existsSync(marker.pidFile)).toBe(false)
  })

  it('never logs the chat text, on success or failure', async () => {
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => {})
    )
    const echo = `process.stdin.pipe(process.stdout)\n`
    const verdicts = [
      await classifyIdleRecoveryEnding(input(), settingsFor(script('leak-ok.js', echo))),
      await classifyIdleRecoveryEnding(
        input(),
        settingsFor(script('leak-fail.js', `${echo}process.exitCode = 2\n`))
      )
    ]
    expect(JSON.stringify(verdicts)).not.toContain(CHAT_TEXT)
    for (const log of logs) {
      expect(JSON.stringify(log.mock.calls)).not.toContain(CHAT_TEXT)
    }
  })
})

describe('classifyIdleRecoveryEnding without a command', () => {
  function builtinSettings(): IdleRecoverySettings {
    return settingsFor(undefined)
  }

  it('uses the built-in check', async () => {
    expect(builtinSettings().classifierCommand).toBeNull()
    expect(
      await classifyIdleRecoveryEnding(input('Should I go on?'), builtinSettings())
    ).toMatchObject({ verdict: 'waiting_user', question: 'Should I go on?' })
    expect(
      await classifyIdleRecoveryEnding(input('I will run the tests next.'), builtinSettings())
    ).toMatchObject({ verdict: 'finished' })
  })
})
