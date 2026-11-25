// What opening a chat after a restart does to the Task text a held worker launch never sent
// (BAD-818): the real journal and its writer, opened through the production conversation open, then
// the delivery loop's own restart step.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const faked = vi.hoisted(() => ({ userData: '' }))
vi.mock('../../../shared/app-lifecycle/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => faked.userData }),
  hasAppEnvironment: () => true
}))

import { agentSessionSendBodyFingerprint } from '../../../shared/agent-session/requests/structured-agent-session-send-mutation'
import { closeTestJournalHostDatabase } from '../../native-chat/agent-session-journal/store-lifecycle/journal-host-database-test-support'
import { holdRestartedStructuredAgentSessionSends } from '../../native-chat/agent-session-wire/delivery/structured-agent-session-queued-pause'
import { openTestAttachConversation } from '../../native-chat/agent-session-wire/host/testing/structured-agent-session-attach-test-conversation.test-fixture'
import { recordingStructuredAgentSessionLogger } from '../../native-chat/agent-session-wire/host/testing/structured-agent-session-logger.test-fixture'
import { record } from '../../native-chat/agent-session-wire/recovery/testing/structured-agent-session-restart-resume.test-fixture'
import { openTestAgentSessionDatabase } from '../../runtime/agent-session/records/agent-session-record-store-test-harness'
import {
  noteForkPauseAllHeldLaunch,
  resetForkPauseAllHeldNotesForTests
} from './pause-all-held-notes'

const chat = record()
const body = {
  kind: 'message' as const,
  role: 'user' as const,
  blocks: [{ type: 'text' as const, text: 'the Task' }]
}

async function openChat() {
  return openTestAttachConversation(await openTestAgentSessionDatabase(faked.userData))(chat)
}

/** The Task text, accepted and not sent; `handedOver` has been given to the agent. */
async function acceptTask(handedOver = false): Promise<void> {
  const journal = await openChat()
  const accept = (clientMessageId: string) =>
    journal.write({
      kind: 'submission',
      input: {
        clientMessageId,
        body,
        payloadFingerprint: agentSessionSendBodyFingerprint(chat.sessionId, body),
        fence: chat.lease.runtimeFence,
        origin: 'host',
        source: { kind: 'agent' },
        handoverRecorded: true
      }
    })
  await accept('task')
  if (handedOver) {
    await journal.write({
      kind: 'dispatch',
      input: {
        clientMessageId: 'task',
        state: 'pending',
        turnScope: { kind: 'thread' },
        fence: chat.lease.runtimeFence
      }
    })
    await accept('follow-up')
  }
  await journal.close()
  await closeTestJournalHostDatabase(faked.userData)
}

/** The chat opened by a later process, as its delivery loop leaves the Task text. */
async function afterRestart() {
  const journal = await openChat()
  await holdRestartedStructuredAgentSessionSends(
    recordingStructuredAgentSessionLogger().logger,
    chat.sessionId,
    journal,
    chat.lease.runtimeFence
  )
  const first = (await journal.reads.input({ kind: 'first-queued' })).submission
  const task = await journal.reads.submission('task')
  await journal.close()
  return { first: first?.clientMessageId, state: task?.dispatchState, rejection: task?.rejection }
}

beforeEach(() => {
  faked.userData = mkdtempSync(join(tmpdir(), 'pause-all-unsent-'))
  resetForkPauseAllHeldNotesForTests()
})
afterEach(async () => {
  resetForkPauseAllHeldNotesForTests()
  await closeTestJournalHostDatabase(faked.userData)
  rmSync(faked.userData, { recursive: true, force: true })
})

describe('the Task text a worker launch never sent, after a restart', () => {
  it('is still the next message when the launch is held by pause-all', async () => {
    await acceptTask()
    noteForkPauseAllHeldLaunch(chat.sessionId)
    expect(await afterRestart()).toEqual({ first: 'task', state: 'pending', rejection: undefined })
    // Opened again, as by a second restart.
    await closeTestJournalHostDatabase(faked.userData)
    expect(await afterRestart()).toMatchObject({ first: 'task', state: 'pending' })
  })

  it('is failed as upstream does when nothing holds the launch', async () => {
    await acceptTask()
    expect(await afterRestart()).toMatchObject({
      first: undefined,
      state: 'rejected',
      rejection: { kind: 'hostRestarted' }
    })
  })

  it('that was handed over is never sent again, and what followed it fails as upstream does', async () => {
    await acceptTask(true)
    noteForkPauseAllHeldLaunch(chat.sessionId)
    expect(await afterRestart()).toMatchObject({ first: undefined })
  })
})
