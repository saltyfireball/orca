// BAD-764: the guards and a chat that starts before the runtime settles, in the app's own order. The
// desktop awaits installForkReady and the headless server calls installForkHeadlessHost before any
// chat is restored, adopted or started; the runtime settles later (after the window has loaded), so
// nothing here settles it. Real store, session host, launch and Agent SDK, on the stand-in CLI.
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestStores, createStore, testState } from '../../persistence/persistence-test-harness'
import { ensureTestStructuredAgentSessionHost as ensureStructuredAgentSessionHost } from '../../runtime/agent-session/records/agent-session-record-store-test-harness'
import { stopStructuredAgentSessionRuntime } from '../../runtime/agent-session/installation/structured-agent-session-runtime'
import { installForkHeadlessHost } from '../headless-host'
import { installForkReady } from '../fork-ready-foundation-hooks'
import { forkMarkHeadlessSettingsHost } from '../settings-cli/settings-cli-headless'
import { installForkWorkspaceFolders } from '../workspace-folder/workspace-folder-path'
import {
  askGuardChat,
  attachGuardChat,
  decisionOf,
  guardHostDeps,
  sendGuardChat
} from './command-guards-chat.test-fixture'
import { resetCommandGuardChats } from './command-guards-chat-registry'
import { installForkCommandGuards } from './command-guards-install'
import { stopForkCommandGuards } from './command-guards-live'
import { forkCommandGuardStatus } from './command-guards-status'

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir,
    on: () => {},
    once: () => {},
    whenReady: () => Promise.resolve()
  },
  globalShortcut: { register: () => true, unregister: () => {}, isRegistered: () => false },
  ipcMain: { handle: () => {}, on: () => {}, removeHandler: () => {} },
  BrowserWindow: class {},
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../telemetry/client', () => ({ track: vi.fn() }))

let answers = ''
let scratch = ''
let state = ''
const stops: (() => void)[] = []

beforeAll(() => {
  // One path for every test: the host reads its environment once.
  answers = mkdtempSync(join(tmpdir(), 'guard-order-answers-'))
  process.env.GUARD_FAKE_ANSWER_FILE = join(answers, 'hook-answer.jsonl')
})
afterAll(() => {
  delete process.env.GUARD_FAKE_ANSWER_FILE
  rmSync(answers, { recursive: true, force: true })
})
beforeEach(() => {
  testState.dir = mkdtempSync(join(tmpdir(), 'guard-order-data-'))
  scratch = mkdtempSync(join(tmpdir(), 'guard-order-'))
  state = mkdtempSync(join(tmpdir(), 'guard-order-state-'))
  execFileSync('git', ['init', '-q', '-b', 'main', scratch])
  stopForkCommandGuards()
  resetCommandGuardChats()
})
afterEach(async () => {
  for (const stop of stops.splice(0)) {
    stop()
  }
  stopForkCommandGuards()
  installForkWorkspaceFolders(null)
  forkMarkHeadlessSettingsHost(false)
  await stopStructuredAgentSessionRuntime()
  await closeTestStores()
  for (const dir of [testState.dir, scratch, state]) {
    rmSync(dir, { recursive: true, force: true })
  }
})

async function startChat() {
  const session = `chat-${randomUUID()}`
  const host = await ensureStructuredAgentSessionHost(guardHostDeps({ state, scratch }))
  await attachGuardChat(host, session, state)
  return {
    ask: (command = 'git push --force origin main') => askGuardChat(host, session, command),
    send: (command = 'git push --force origin main') => sendGuardChat(host, session, command)
  }
}

const nativeChat = () =>
  forkCommandGuardStatus([]).surfaces?.find((row) => row.surface === 'native-chat')

const GUARDED = { guarded: true, chats: { guarded: 1, unguarded: 0 } }

describe('command guards before the runtime settles', () => {
  it('the desktop: a chat started right after installForkReady is guarded, by the live settings', async () => {
    const store = createStore()
    await installForkReady(store)
    const chat = await startChat()
    expect(decisionOf(await chat.ask())).toMatchObject({
      decision: 'deny',
      reason: expect.stringContaining('command guard (force-push)')
    })
    expect(nativeChat()).toMatchObject(GUARDED)

    // Turning the guards off and on applies to the chat that is already running.
    store.updateSettings({ forkCommandGuards: false })
    expect(decisionOf(await chat.ask()).decision).toBeNull()
    expect(forkCommandGuardStatus([]).enabled).toBe(false)
    store.updateSettings({ forkCommandGuards: true })
    expect(decisionOf(await chat.ask()).decision).toBe('deny')
    store.updateSettings({ forkCommandGuardDisabledRules: 'force-push' })
    expect(decisionOf(await chat.ask()).decision).toBeNull()
  }, 60_000)

  it('a chat started with the guards off is guarded once they are turned on', async () => {
    const store = createStore()
    store.updateSettings({ forkCommandGuards: false })
    await installForkReady(store)
    const chat = await startChat()
    expect(decisionOf(await chat.ask()).decision).toBeNull()
    store.updateSettings({ forkCommandGuards: true })
    expect(decisionOf(await chat.ask()).decision).toBe('deny')
  }, 60_000)

  it('the headless server: a chat started right after installForkHeadlessHost is guarded', async () => {
    stops.push(installForkHeadlessHost(createStore()))
    const chat = await startChat()
    expect(decisionOf(await chat.ask()).decision).toBe('deny')
    expect(nativeChat()).toMatchObject(GUARDED)
  }, 60_000)

  it('a call made before the guards start waits for them, and the chat shows unguarded until then', async () => {
    const chat = await startChat()
    expect(nativeChat()).toMatchObject({ guarded: false, chats: { guarded: 0, unguarded: 1 } })
    const answer = await chat.send()
    let settled = false
    const asked = answer().then((value) => {
      settled = true
      return value
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(settled).toBe(false)
    installForkCommandGuards(createStore())
    expect(decisionOf(await asked).decision).toBe('deny')
    expect(nativeChat()).toMatchObject(GUARDED)
  }, 60_000)

  it('a call made before the guards start goes through when they start turned off', async () => {
    const chat = await startChat()
    const answer = await chat.send()
    const store = createStore()
    store.updateSettings({ forkCommandGuards: false })
    installForkCommandGuards(store)
    expect(decisionOf(await answer()).decision).toBeNull()
  }, 60_000)

  it('holds up a host that never starts them once, not at every call', async () => {
    stopForkCommandGuards(700)
    const chat = await startChat()
    expect(decisionOf(await chat.ask()).decision).toBeNull()
    const from = Date.now()
    expect(decisionOf(await chat.ask()).decision).toBeNull()
    expect(decisionOf(await chat.ask()).decision).toBeNull()
    expect(Date.now() - from).toBeLessThan(700)
    expect(nativeChat()).toMatchObject({ guarded: false })
  }, 60_000)
})
