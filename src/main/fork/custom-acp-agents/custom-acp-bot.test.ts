// BAD-873 proof: a bot on a custom ACP agent, through the real runtime, bot store, bot chat start,
// bot instructions, session host and ACP client, on the made-up agent pebble. Its persona reaches the
// agent only where the agent takes a system prompt; an agent that keeps its own gets the bot rules
// alone; and Pause all holds the bot chat's mail until resume-all.
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { startBotSession } from '../../bots/bot-chat-session'
import { botHomeFolder } from '../../bots/bot-home'
import { botRulesBlock } from '../../bots/bot-preamble'
import { closeTestStores, testState } from '../../persistence/persistence-test-harness'
import { stopStructuredAgentSessionRuntime } from '../../runtime/agent-session/installation/structured-agent-session-runtime'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import {
  countForkPauseAllHeldMail,
  resetForkPauseAllBotMailForTests
} from '../pause-all/pause-all-bot-mail'
import { resetForkPauseAllCacheForTests, writeForkPauseAll } from '../pause-all/pause-all-state'
import { resetForkCustomAcpEnvStoreForTests } from './custom-acp-agent-env-store'
import { resetForkCustomAcpAgentsHostForTests } from './custom-acp-agents-host'
import {
  buildProviderSupervisor,
  customAcpRuntime,
  reportEntries,
  savePebble,
  until,
  waitForRow
} from './custom-acp.test-fixture'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir, getVersion: () => '0.0.0' },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../telemetry/client', () => ({ track: vi.fn() }))

const SOUL = '# Lantern\n\nMade-up soul: answers like a patient lighthouse keeper.\n'

let work = ''
let report = ''
let appRoot = ''

beforeAll(() => {
  appRoot = buildProviderSupervisor()
})

afterAll(() => {
  rmSync(appRoot, { recursive: true, force: true })
})

const requests = (method: string) =>
  reportEntries(report).filter((entry) => entry.method === method)

/** A bot on pebble, its SOUL.md made up, and its chat started with a first message. */
async function botOnPebble(
  saved: Record<string, unknown>
): Promise<{ runtime: OrcaRuntimeService; sessionId: string }> {
  const { runtime } = await customAcpRuntime(appRoot, work)
  await savePebble(runtime, report, saved)
  const created = await runtime.bots.create({ name: 'Lantern' })
  const bot = await runtime.bots.update(created.id, {
    agent: 'custom-acp',
    customAcpAgent: 'pebble'
  })
  writeFileSync(join(botHomeFolder(bot), 'SOUL.md'), SOUL)
  const sessionId = await startBotSession(runtime, bot, {
    message: { text: 'hello pebble', clientMessageId: randomUUID() }
  })
  return { runtime, sessionId }
}

beforeEach(() => {
  testState.dir = mkdtempSync(join(tmpdir(), 'custom-acp-bot-data-'))
  work = mkdtempSync(join(tmpdir(), 'custom-acp-bot-work-'))
  report = `${work}-report.jsonl`
  resetForkPauseAllCacheForTests()
})

afterEach(async () => {
  await stopStructuredAgentSessionRuntime()
  await closeTestStores()
  resetForkCustomAcpAgentsHostForTests()
  resetForkCustomAcpEnvStoreForTests()
  resetForkPauseAllBotMailForTests()
  resetForkPauseAllCacheForTests()
  rmSync(testState.dir, { recursive: true, force: true })
  rmSync(work, { recursive: true, force: true })
  rmSync(report, { force: true })
})

describe('a bot on a custom ACP agent', () => {
  // Starts the real agent program under Orca's supervisor and the real chat host: seconds, not ms.
  it('sends an agent that keeps its own persona the bot rules only, never SOUL.md', async () => {
    const { sessionId } = await botOnPebble({ ownsPrompt: true })
    await waitForRow(sessionId, 'Pebble heard you.')
    const opened = requests('session/new')[0]?.params
    expect(opened?._meta?.orca?.context).toBe(botRulesBlock('custom-acp'))
    expect(opened?._meta?.orca?.systemPrompt).toBeUndefined()
    expect(JSON.stringify(reportEntries(report))).not.toContain('lighthouse keeper')
  }, 60_000)

  // Starts the real agent program under Orca's supervisor and the real chat host: seconds, not ms.
  it('gives SOUL.md as the system prompt to an agent that takes one', async () => {
    const { sessionId } = await botOnPebble({ env: { PEBBLE_TAKES_SYSTEM_PROMPT: '1' } })
    await waitForRow(sessionId, 'Pebble heard you.')
    const prompt = requests('session/new')[0]?.params?._meta?.orca?.systemPrompt
    expect(prompt).toContain('lighthouse keeper')
    expect(prompt).toContain(botRulesBlock('custom-acp').split('\n')[0])
  }, 60_000)

  // Starts the real agent program under Orca's supervisor and the real chat host: seconds, not ms.
  it('refuses plainly when the agent takes no system prompt and does not keep its own', async () => {
    const { sessionId } = await botOnPebble({})
    await waitForRow(sessionId, '--owns-prompt')
    expect(requests('session/prompt')).toHaveLength(0)
  }, 60_000)

  // Starts the real agent program under Orca's supervisor and the real chat host: seconds, not ms.
  it("holds the bot chat's mail while Pause all is on, and resume-all delivers it", async () => {
    const { runtime, sessionId } = await botOnPebble({ ownsPrompt: true })
    await waitForRow(sessionId, 'Pebble heard you.')
    writeForkPauseAll(true, { by: 'test' })
    const mailbox = `orca_session_id:${sessionId}`
    runtime.getOrchestrationDb().insertMessage({
      from: 'term_made_up_worker',
      to: mailbox,
      subject: 'The tide table changed',
      body: 'Check the new tide table.',
      type: 'status'
    })
    runtime.deliverPendingMessagesForHandle(mailbox)
    // ast-grep-ignore: test-no-real-time-wait -- nothing signals a mail that was not sent, so the hold is proven over a window.
    await new Promise((resolveWait) => setTimeout(resolveWait, 1500))
    expect(requests('session/prompt')).toHaveLength(1)
    expect(countForkPauseAllHeldMail(runtime)).toBe(1)
    writeForkPauseAll(false, { by: 'test' })
    await until(
      () => (requests('session/prompt').length === 2 ? true : null),
      'the mail at resume-all'
    )
    expect(JSON.stringify(requests('session/prompt')[1]?.params)).toContain('tide table')
  }, 60_000)
})
