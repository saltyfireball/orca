// BAD-838: a look or tidy-up whose agent refused to start records why, not only "didn't finish".
// Real: both runners, the look-around store and its Up next view, the bot run's conversation start
// (botAutomationSessions over the host's create with a first message, as a bot's background chat
// starts), watchBotTurnEnds, and a structured agent session host whose Claude start is refused with
// the refusal Claude's own initialize reply makes when it is not signed in.
// Faked: the bot, power, and the provider process under the host.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Bot } from '../../../shared/bot-types'
import { claudeInitializationAuthError } from '../../claude/structured/startup/claude-structured-init-proof'
import { botAutomationSessions } from '../../bots/bot-automation-sessions'
import { botMessageBody } from '../../bots/bot-chat-session'
import { BotLookAroundRunner } from '../../bots/bot-look-around-runner'
import { BotLookAroundStore } from '../../bots/bot-look-around-store'
import { upNextState } from '../../bots/bot-look-around-state'
import { tidyUpState } from '../../bots/bot-memory-tidy-up'
import { BotTidyUpRunner } from '../../bots/bot-memory-tidy-up-runner'
import { watchBotTurnEnds } from '../../bots/bot-run-turn-watch'
import { readTestHostJournal } from '../../native-chat/agent-session-journal/journal-observation.test-support'
import { createTestParams } from '../../native-chat/agent-session-wire/host/testing/structured-agent-session-create.test-fixture'
import {
  createRestTestRig,
  REST_TEST_CALLER,
  type RestTestRig
} from '../../native-chat/agent-session-wire/host/testing/structured-agent-session-rest-test-rig.test-fixture'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the runners read only these bot fields.
const BOT = {
  id: 'bot-1',
  name: 'Fern',
  agent: 'claude',
  paused: false,
  createdAt: 0,
  folderWorkspaceId: 'home-1',
  lookAround: { on: true, every: 'every-2h', weekdaysOnly: false, focus: '' },
  tidyUp: { on: true, every: 'night' }
} as unknown as Bot

const power = {
  settled: () => true,
  checkFullWake: async () => true,
  suspends: () => 0,
  epoch: () => 0,
  awakeNow: () => Date.now(),
  wallNow: () => Date.now(),
  holdAwake: () => () => {}
}

const NOT_SIGNED_IN =
  "This Claude account isn't signed in. Sign in again in Claude Accounts settings."

let rig: RestTestRig | null = null
afterEach(async () => {
  await rig?.dispose()
  rig = null
})

/** A host whose Claude starts are refused as signed out, and the runs' deps around it. */
async function signedOutHost() {
  rig = await createRestTestRig()
  const host = rig.host
  const refusal = claudeInitializationAuthError({ account: { tokenSource: 'none' } }, 'managed')
  rig.adapter.acquire.mockRejectedValue(refusal)
  const started: string[] = []
  const unused = async (): Promise<never> => {
    throw new Error('not used by a look or tidy-up')
  }
  const sessions = botAutomationSessions({
    // As a bot's background chat starts: created at rest with its opening message and the run's gates.
    startSession: async (_bot, message, _actsFor, sessionId, gates) => {
      const firstMessage = {
        clientMessageId: message.clientMessageId,
        body: botMessageBody(message.text)
      }
      const created = await host.create(
        REST_TEST_CALLER,
        createTestParams(
          firstMessage,
          {
            agent: 'claude',
            provider: 'claude',
            accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: '/private-fixture/claude' }
          },
          sessionId
        ),
        { firstMessage, ...gates }
      )
      expect(created).toMatchObject({ ok: true })
      started.push(sessionId!)
      return sessionId!
    },
    nameSession: async () => {},
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a look and a tidy-up only start conversations.
    chats: {} as never,
    chatTakingMail: unused,
    sendToGroupRoom: unused
  })
  const store = new BotLookAroundStore({ read: () => null, write: async () => {} }, () => {})
  const deps = {
    bots: () => [BOT],
    store,
    sessions: { ...sessions, release: async () => {} },
    watchTurns: async () => watchBotTurnEnds(host),
    stopTurn: async () => {},
    turnRunning: () => false,
    turnOff: vi.fn(async () => {}),
    power,
    now: Date.now
  }
  /** The chat recorded the refusal the app logged: a signed-out managed account. */
  const refusedAsSignedOut = async (): Promise<void> => {
    const { submissions } = await readTestHostJournal(host, started[0]!)
    expect(submissions.at(-1)?.rejection).toMatchObject({ kind: 'notSignedIn', account: 'managed' })
  }
  return { deps, store, refusedAsSignedOut }
}

describe('a background run whose agent refused to start', () => {
  it('records the reason on a look and shows it on Up next', async () => {
    const { deps, store, refusedAsSignedOut } = await signedOutHost()
    const looks = new BotLookAroundRunner({
      ...deps,
      hadConversation: async () => true,
      usageLimitOf: async () => null,
      usageLimitContinues: async () => false
    })
    expect(looks.lookNow(BOT.id)).toEqual({ started: true })
    await vi.waitFor(() => expect(store.get(BOT.id).runs.at(-1)?.endedAt).toBeDefined())
    await refusedAsSignedOut()
    const expected = `The last look didn't finish. ${NOT_SIGNED_IN}`
    expect(store.get(BOT.id).runs.at(-1)?.error).toBe(expected)
    expect(upNextState(store.get(BOT.id), undefined).error).toBe(expected)
  })

  it('records the reason on a tidy-up', async () => {
    const { deps, store, refusedAsSignedOut } = await signedOutHost()
    const tidy = new BotTidyUpRunner({
      ...deps,
      newChats: async () => [
        { title: 'Plans', lines: [{ by: 'owner', text: 'Remember Tuesdays.' }] }
      ],
      busy: () => false,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a run that fails before its reply reads no memory history.
      memory: { change: vi.fn(), history: async () => [] } as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: tidy-up reads MEMORY.md and the pilot marker only.
      fs: { readText: async () => '- A fact.\n', statFile: async () => null } as never,
      memoryFiles: async () => [],
      homeFolder: () => '/home/fern',
      noteTidied: () => {}
    })
    expect(tidy.tidyNow(BOT.id)).toEqual({ started: true })
    await vi.waitFor(() =>
      expect(tidyUpState(store.get(BOT.id)).runs.at(-1)?.endedAt).toBeDefined()
    )
    await refusedAsSignedOut()
    expect(tidyUpState(store.get(BOT.id)).runs.at(-1)?.error).toBe(
      `The last tidy-up didn't finish. ${NOT_SIGNED_IN}`
    )
  })
})
