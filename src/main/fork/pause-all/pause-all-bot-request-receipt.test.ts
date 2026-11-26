// Pause all over bot mail (BAD-818): what the sender of a request to a bot reads. Through the real
// `orchestration.send` RPC and the real hold, with the real switch in a temporary data folder: while
// paused the receipt says the request waits for resume-all, not that the bot has it. Faked: the bot
// fixture's chat lookups and the agent-session host's record list.
import '../../runtime/rpc/dispatch/testing/unused-default-rpc-methods.test-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { createOrchestrationRpcHarness } from '../../runtime/rpc/methods/orchestration/rpc-test-harness'
import type * as RecipientRouting from '../../runtime/rpc/methods/orchestration/messaging/recipient-routing'
import {
  DOCS_CHAT,
  RANGER_CHAT,
  setupBotMail
} from '../../runtime/rpc/methods/orchestration/messaging/bot-recipient.test-fixture'
import { resetForkPauseAllBotMailForTests } from './pause-all-bot-mail'
import { resetForkPauseAllCacheForTests, writeForkPauseAll } from './pause-all-state'

const paths = vi.hoisted(() => ({
  userData: '',
  fixture: '../../runtime/rpc/methods/orchestration/messaging/bot-recipient.test-fixture'
}))
vi.mock('../../../shared/app-lifecycle/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => paths.userData }),
  hasAppEnvironment: () => true
}))
vi.mock('../../bots/bot-session-tabs', async () => (await import(paths.fixture)).botSessionTabsMock)
vi.mock('../../bots/bot-chat-session', async () => (await import(paths.fixture)).botChatSessionMock)
vi.mock(
  '../../bots/bot-chat-mail-hold',
  async () => (await import(paths.fixture)).botChatMailHoldMock
)
vi.mock(
  '../../bots/bot-chat-status-line',
  async () => (await import(paths.fixture)).botChatStatusLineMock
)
vi.mock(
  '../../runtime/rpc/methods/orchestration/messaging/recipient-routing',
  async (importOriginal) =>
    (await import(paths.fixture)).recipientRoutingMock(
      await importOriginal<typeof RecipientRouting>()
    )
)

/** Docs's own chat, in its home (the fixture's bots live in folder w1). */
function installHost(): void {
  const records = [{ sessionId: DOCS_CHAT, location: { workspaceId: 'folder:w1' }, updatedAt: 1 }]
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hold reads only the record list.
  setStructuredAgentSessionHost({
    deps: {
      store: {
        getConversation: (id: string) => records.find((record) => record.sessionId === id),
        listConversations: () => records,
        getVisibleSessionTabIndex: () => null
      }
    }
  } as never)
}

describe('the receipt of a request to a bot while paused', () => {
  const h = createOrchestrationRpcHarness()
  let mail: ReturnType<typeof setupBotMail>
  beforeEach(() => {
    paths.userData = mkdtempSync(join(tmpdir(), 'pause-all-receipt-'))
    resetForkPauseAllCacheForTests()
    resetForkPauseAllBotMailForTests()
    mail = setupBotMail(h)
    installHost()
  })
  afterEach(() => {
    setStructuredAgentSessionHost(null)
    resetForkPauseAllBotMailForTests()
    h.cleanup()
    rmSync(paths.userData, { recursive: true, force: true })
  })

  const handOff = (subject: string) =>
    mail.sent(RANGER_CHAT, { to: 'bot:Docs', type: 'handoff', subject, body: 'Fix the docs.' })

  it('says the bot has it when running, and that it waits for resume-all while paused', async () => {
    const running = await handOff('first')
    expect(running.next).toContain('Docs has it now')

    writeForkPauseAll(true, { by: 'cli' })
    const paused = await handOff('second')
    expect(paused.message).toMatchObject({ to_handle: `orca_session_id:${DOCS_CHAT}` })
    expect(paused.next).not.toContain('has it now')
    expect(paused.next).toContain('Paused by pause-all')
    expect(paused.next).toContain('reaches Docs once at resume-all')
    expect(paused.next).toContain('Tell the asker in one line that it waits for resume-all.')
  })
})
