import '../../../dispatch/testing/unused-default-rpc-methods.test-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrchestrationDb } from '../../../../orchestration/db/orchestration-db'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import { createOrchestrationRpcHarness } from '../rpc-test-harness'
import type * as RecipientRouting from './recipient-routing'
import { DOCS_CHAT, setupBotMail } from './bot-recipient.test-fixture'

vi.mock(
  '../../../../../bots/bot-session-tabs',
  async () => (await import('./bot-recipient.test-fixture')).botSessionTabsMock
)
vi.mock(
  '../../../../../bots/bot-chat-session',
  async () => (await import('./bot-recipient.test-fixture')).botChatSessionMock
)
vi.mock(
  '../../../../../bots/bot-chat-mail-hold',
  async () => (await import('./bot-recipient.test-fixture')).botChatMailHoldMock
)
vi.mock(
  '../../../../../bots/bot-chat-status-line',
  async () => (await import('./bot-recipient.test-fixture')).botChatStatusLineMock
)
vi.mock('./recipient-routing', async (importOriginal) =>
  (await import('./bot-recipient.test-fixture')).recipientRoutingMock(
    await importOriginal<typeof RecipientRouting>()
  )
)

// BAD-742: a service with no terminal or chat (Aria's bot_chat_reply) mails a bot's chat as the owner.
describe('mail to a bot chat from a sender with no terminal', () => {
  const h = createOrchestrationRpcHarness()
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  beforeEach(() => {
    ;({ db, runtime } = setupBotMail(h))
  })
  afterEach(() => h.cleanup())

  it('lands in the chat the message names, as the owner own words', async () => {
    const receipt = JSON.parse(
      JSON.stringify(
        await h.call(
          'orchestration.send',
          {
            to: 'bot:Docs',
            chat: DOCS_CHAT,
            type: 'handoff',
            subject: 'From a service',
            body: 'use pnpm'
          },
          { runtime }
        )
      )
    )
    expect(receipt.message).toMatchObject({
      to_handle: `orca_session_id:${DOCS_CHAT}`,
      type: 'handoff'
    })
    expect(db.getAllMessagesForHandle(`orca_session_id:${DOCS_CHAT}`)).toHaveLength(1)
  })
})
