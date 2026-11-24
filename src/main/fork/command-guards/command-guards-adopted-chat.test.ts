// BAD-764: a chat that survives an app restart keeps its Claude process, whose hook callbacks were
// registered by the app that quit. Two app instances, each its own process on the real session host
// (command-guards-app-instance.test-fixture.ts): the first starts the chat and hands it to its broker
// at quit, the second restores the chat's tab and adopts it. The stand-in CLI answers a later
// initialize as the real one does; command-guards-real-claude.test.ts runs this on the real CLI.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  journalSqlReaderPath,
  journalSqlWorkerPath
} from '../../native-chat/agent-session-journal/journal-sql-worker-bundle.test-fixture'
import { LOOK_AROUND_REFUSAL } from '../../bots/bot-look-around-policy'
import {
  endGuardApps,
  guardSurfaceRow as row,
  ownGuardBroker,
  startGuardApp
} from './command-guards-app-process.test-fixture'
import { decisionOf } from './command-guards-chat.test-fixture'

const FIXTURE = join(import.meta.dirname, 'command-guards-app-instance.test-fixture.ts')
const dirs: string[] = []

afterEach(() => {
  endGuardApps()
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gac-'))
  dirs.push(dir)
  return dir
}

function startApp(config: Record<string, unknown>, env: Record<string, string>) {
  const app = startGuardApp(FIXTURE, { ...env, GUARD_APP_CONFIG: JSON.stringify(config) })
  return {
    ...app,
    run: async (command: string) => decisionOf((await app.ask(`ask ${command}`, 'answer')).answer),
    status: () => app.ask('status', 'status')
  }
}

/** The first app starts the chat, hands it to its broker and quits; the second app adopts it. */
async function acrossARestart(input: {
  second: { startGuards: boolean }
  readOnly?: 'look-around'
  oldCli?: boolean
}) {
  const scratch = tempDir()
  const state = tempDir()
  execFileSync('git', ['init', '-q', '-b', 'main', scratch])
  const session = `chat-${randomUUID()}`
  const config = {
    session,
    state,
    scratch,
    recordDir: join(state, 'chat-survive'),
    writerPath: journalSqlWorkerPath(),
    readerPath: journalSqlReaderPath(),
    ...(input.readOnly ? { readOnly: input.readOnly } : {})
  }
  const env: Record<string, string> = {
    GUARD_FAKE_ANSWER_FILE: join(scratch, 'answers.jsonl'),
    ...(input.oldCli ? { GUARD_FAKE_OLD_CLI: '1' } : {})
  }
  const first = startApp({ ...config, mode: 'first', startGuards: true }, env)
  const owner = Number((await first.next('ready')).owner)
  ownGuardBroker(owner)
  expect(row(await first.status())).toMatchObject({ guarded: true, chats: { guarded: 1 } })
  await first.ask('quit', 'quit')
  await first.kill()
  const second = startApp({ ...config, mode: 'adopt', ...input.second }, env)
  // The same provider process: the chat was adopted, not started again.
  expect((await second.next('ready')).owner).toBe(owner)
  return { session, second }
}

describe.runIf(process.platform === 'darwin')('a guarded chat across an app restart', () => {
  it('is guarded by the app that adopts it', async () => {
    const { second, session } = await acrossARestart({
      second: { startGuards: true }
    })
    expect((await second.status()).chats).toEqual([
      { sessionId: session, surface: 'native-chat', guarded: true }
    ])
    expect(await second.run('git push --force origin main')).toMatchObject({
      decision: 'deny',
      reason: expect.stringContaining('command guard (force-push)')
    })
    expect((await second.run('git status')).decision).toBeNull()
  }, 90_000)

  it('is guarded when it is adopted before the guards start', async () => {
    const { second } = await acrossARestart({
      second: { startGuards: false }
    })
    expect(row(await second.status())).toMatchObject({ guarded: false })
    // Made before the guards start: it waits for them instead of slipping through.
    const answer = second.run('git push --force origin main')
    second.send('start')
    expect((await answer).decision).toBe('deny')
    expect(row(await second.status())).toMatchObject({
      guarded: true,
      chats: { guarded: 1, unguarded: 0 }
    })
  }, 90_000)

  it('a look-around keeps its own limit and gets the guard', async () => {
    const { second } = await acrossARestart({
      second: { startGuards: true },
      readOnly: 'look-around'
    })
    expect(await second.run('touch made-it')).toMatchObject({
      decision: 'deny',
      reason: LOOK_AROUND_REFUSAL
    })
  }, 90_000)

  it('shows unguarded while Claude Code has not confirmed the hook, and guarded once it is called', async () => {
    const { second, session } = await acrossARestart({
      second: { startGuards: true },
      oldCli: true
    })
    const before = await second.status()
    expect(before.chats).toMatchObject([
      { sessionId: session, guarded: false, reason: expect.stringContaining('app restart') }
    ])
    expect(row(before)).toMatchObject({
      guarded: false,
      note: expect.stringContaining('carried over an app restart')
    })
    expect((await second.run('git push --force origin main')).decision).toBe('deny')
    expect(row(await second.status())).toMatchObject({ guarded: true })
  }, 90_000)
})
