// BAD-873 proof: a chat on a custom ACP agent, through the real runtime, chat create, session host,
// ACP launch and client. The agent is a made-up node program (pebble-acp-agent.test-fixture.mjs)
// that records what Orca sent it. Saved through the real fork.customAcpAgents.add handler.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestStores, testState } from '../../persistence/persistence-test-harness'
import { stopStructuredAgentSessionRuntime } from '../../runtime/agent-session/installation/structured-agent-session-runtime'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { forkStopChatTurn } from '../chat-host-turn-stop'
import { resetForkCustomAcpEnvStoreForTests } from './custom-acp-agent-env-store'
import { resetForkCustomAcpAgentsHostForTests } from './custom-acp-agents-host'
import {
  CUSTOM_ACP_CALLER,
  PEBBLE,
  PEBBLE_TOKEN,
  buildProviderSupervisor,
  callCustomAcp,
  customAcpRuntime,
  openJournalSlot,
  reportEntries,
  requireHost,
  savePebble,
  sendChat,
  until,
  waitForRow
} from './custom-acp.test-fixture'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir, getVersion: () => '0.0.0' },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../telemetry/client', () => ({ track: vi.fn() }))

let work = ''
let report = ''
let appRoot = ''

beforeAll(() => {
  appRoot = buildProviderSupervisor()
})

afterAll(() => {
  rmSync(appRoot, { recursive: true, force: true })
})

const entries = () => reportEntries(report)
const requests = (method: string) => entries().filter((entry) => entry.method === method)

async function runtimeWithPebble(saved: Record<string, unknown> = {}): Promise<OrcaRuntimeService> {
  const { runtime } = await customAcpRuntime(appRoot, work)
  await savePebble(runtime, report, saved)
  return runtime
}

async function startPebbleChat(runtime: OrcaRuntimeService, prompt: string): Promise<string> {
  const started = await callCustomAcp<{ sessionId: string }>(
    runtime,
    'fork.customAcpAgents.startChat',
    {
      name: 'pebble',
      worktree: `id:r1::${work}`,
      prompt
    }
  )
  expect(started.sessionId).toEqual(expect.any(String))
  return started.sessionId
}

/** Stops every chat's process as an app quit does, then brings the host back on the same data. */
async function restartHost(runtime: OrcaRuntimeService): Promise<void> {
  await stopStructuredAgentSessionRuntime()
  await openJournalSlot()
  await runtime.ensureStructuredAgentSessionHost()
}

beforeEach(() => {
  testState.dir = mkdtempSync(join(tmpdir(), 'custom-acp-data-'))
  work = mkdtempSync(join(tmpdir(), 'custom-acp-work-'))
  report = `${work}-report.jsonl`
  process.env.ORCA_APP_VERSION = '9.8.7'
})

afterEach(async () => {
  await stopStructuredAgentSessionRuntime()
  await closeTestStores()
  resetForkCustomAcpAgentsHostForTests()
  resetForkCustomAcpEnvStoreForTests()
  delete process.env.ORCA_APP_VERSION
  rmSync(testState.dir, { recursive: true, force: true })
  rmSync(work, { recursive: true, force: true })
  rmSync(`${work}-folder`, { recursive: true, force: true })
  rmSync(report, { force: true })
})

describe('a chat on a custom ACP agent', () => {
  // Starts the real agent program under Orca's supervisor and the real chat host: seconds, not ms.
  it('starts the saved program, streams its reply and names Orca with its version', async () => {
    const runtime = await runtimeWithPebble()
    await waitForRow(await startPebbleChat(runtime, 'hello pebble'), 'Pebble heard you.')
    const start = entries().find((entry) => entry.kind === 'start')
    expect(start).toMatchObject({
      argv: [PEBBLE].slice(1),
      cwd: expect.stringContaining(basename(work))
    })
    // The value reaches the program's environment, never its command line or settings.
    expect(start?.token).toBe(PEBBLE_TOKEN)
    expect(JSON.stringify(start?.argv)).not.toContain(PEBBLE_TOKEN)
    expect(JSON.stringify(runtime.requireStore().getSettings())).not.toContain(PEBBLE_TOKEN)
    expect(String(start?.home)).toContain(join('fork-custom-acp-agents', 'agents', 'pebble'))
    expect(requests('initialize')[0]?.params).toMatchObject({
      protocolVersion: 1,
      clientInfo: { name: 'orca', version: '9.8.7' }
    })
    expect(requests('session/new')[0]?.params).toMatchObject({
      cwd: expect.stringContaining(basename(work)),
      mcpServers: []
    })
    // A plain chat carries no persona, so it runs on an agent without the capability.
    expect(requests('session/new')[0]?.params?._meta).toBeUndefined()
    expect(requests('session/prompt')[0]?.params).toMatchObject({
      sessionId: 'pebble-conversation-1',
      prompt: [expect.objectContaining({ type: 'text', text: 'hello pebble' })]
    })
  }, 60_000)

  // Starts the real agent program twice (before and after a host restart): seconds, not ms.
  it('runs the program in its saved folder and resumes the chat with session/load', async () => {
    const folder = `${work}-folder`
    mkdirSync(folder)
    const runtime = await runtimeWithPebble({ cwd: folder })
    const sessionId = await startPebbleChat(runtime, 'hello pebble')
    await waitForRow(sessionId, 'Pebble heard you.')
    await restartHost(runtime)
    await sendChat(sessionId, 'are you still there')
    await until(() => (requests('session/prompt').length >= 2 ? true : null), 'the resumed turn')
    const starts = entries().filter((entry) => entry.kind === 'start')
    expect(starts).toHaveLength(2)
    expect(starts.map((start) => basename(String(start.cwd)))).toEqual([
      basename(folder),
      basename(folder)
    ])
    // The workspace stays the session's folder; the saved folder is only where the program runs.
    expect(requests('session/new')).toHaveLength(1)
    expect(requests('session/new')[0]?.params?.cwd).toContain(basename(work))
    expect(requests('session/load')[0]?.params).toMatchObject({
      sessionId: 'pebble-conversation-1',
      cwd: expect.stringContaining(basename(work)),
      mcpServers: []
    })
  }, 90_000)

  // Starts the real agent program under Orca's supervisor and the real chat host: seconds, not ms.
  it('stops a running turn with session/cancel', async () => {
    const runtime = await runtimeWithPebble()
    const sessionId = await startPebbleChat(runtime, 'please wait')
    await waitForRow(sessionId, 'Waiting')
    expect(await forkStopChatTurn(requireHost(), sessionId, CUSTOM_ACP_CALLER.callerKey)).toBe(true)
    await until(() => (requests('session/cancel').length > 0 ? true : null), 'the cancel')
    expect(requests('session/cancel')[0]?.params).toEqual({ sessionId: 'pebble-conversation-1' })
  }, 60_000)

  // Starts the real agent program under Orca's supervisor and the real chat host: seconds, not ms.
  it("shows the agent's own error message in the chat", async () => {
    const runtime = await runtimeWithPebble()
    await waitForRow(
      await startPebbleChat(runtime, 'please fail'),
      'The pebble service is unreachable.'
    )
  }, 60_000)

  // Starts the real agent program twice (before and after a host restart): seconds, not ms.
  it('refuses a chat on an agent that is not saved, and one whose agent was removed', async () => {
    const runtime = await runtimeWithPebble()
    await expect(
      callCustomAcp(runtime, 'fork.customAcpAgents.startChat', {
        name: 'gravel',
        worktree: `id:r1::${work}`
      })
    ).rejects.toThrow('No custom agent named gravel is saved on this host')
    const sessionId = await startPebbleChat(runtime, 'hello pebble')
    await waitForRow(sessionId, 'Pebble heard you.')
    await callCustomAcp(runtime, 'fork.customAcpAgents.remove', { name: 'pebble' })
    await restartHost(runtime)
    await sendChat(sessionId, 'are you still there').catch(() => {})
    await waitForRow(sessionId, 'The custom agent pebble is not saved on this host any more')
    expect(entries().filter((entry) => entry.kind === 'start')).toHaveLength(1)
  }, 90_000)
})
