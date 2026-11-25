// Pause all over bot mail (BAD-818): the bot mail owner's real hold, the real orchestration database
// and mail selection, with the real switch in a temporary data folder. Mail to a room member chat
// waits unread while paused (also with an unreadable switch), is counted, and resume-all redrives the
// chat once, in order; a restart after a release while the app was down redrives it then, through the
// real start and also when the chat host is installed after it. Faked: the agent-session host (its
// record list, queue wake and chat lines), the redrive the runtime does, and the chat item mail picks.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const paths = vi.hoisted(() => ({ userData: '' }))
vi.mock('../../../shared/app-lifecycle/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => paths.userData }),
  hasAppEnvironment: () => true
}))

vi.mock('../../bots/bot-mail-chat', () => ({ botMailSession: async () => MEMBER }))
vi.mock('../../bots/bot-items-mail-text', () => ({
  botItemChangeMail: () => ({ subject: 'Item 1', body: 'A comment' }),
  botItemMailImages: () => []
}))
vi.mock('../../bots/bot-item-chat-notes', () => ({
  appendBotItemNote: () => {},
  botItemNote: () => null
}))

import { botMailOwner, startBotGroupsSoon } from '../../bots/bot-group-runtime'
import { setStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { sendBotItemMail } from '../../runtime/rpc/methods/bots-items-mail'
import { FORK_PAUSE_ALL_METHODS } from '../../runtime/rpc/methods/fork/fork-pause-all'
import { selectOwnedMail } from '../../runtime/orchestration/structured-mail-owner-narrowing'
import {
  countForkPauseAllHeldMail,
  installForkPauseAllBotMail,
  PAUSE_ALL_HELD_MAIL_FILE_NAME,
  resetForkPauseAllBotMailForTests
} from './pause-all-bot-mail'
import {
  PAUSE_ALL_STATE_FILE_NAME,
  resetForkPauseAllCacheForTests,
  writeForkPauseAll
} from './pause-all-state'

const MEMBER = 'bot-group-member-bot-a'
const MAILBOX = `orca_session_id:${MEMBER}`

let db: OrchestrationDb
let runId: string
const wakeQueuedMessages = vi.fn()
const chatLine = vi.fn()

function installHost(): void {
  const records = [{ sessionId: MEMBER, location: { workspaceId: 'folder:room' } }]
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hold reads only the record list, the queue wake and a chat line's write.
  setStructuredAgentSessionHost({
    deps: {
      store: {
        getConversation: (id: string) => records.find((record) => record.sessionId === id),
        listConversations: () => records,
        getVisibleSessionTabIndex: () => null
      }
    },
    captureAgentStartDestination: async () => ({}),
    appendAgentStart: async (_to: unknown, line: { body: { text: string } }) =>
      chatLine(line.body.text),
    wakeQueuedMessages
  } as never)
}

beforeEach(() => {
  paths.userData = mkdtempSync(join(tmpdir(), 'pause-all-mail-'))
  resetForkPauseAllCacheForTests()
  resetForkPauseAllBotMailForTests()
  db = new OrchestrationDb(join(paths.userData, 'orchestration.db'))
  runId = db.createRun({
    objective: 'o',
    coordinatorHandle: 'term_c',
    coordinatorPaneKey: null,
    coordinatorOrcaSessionId: null
  }).id
  installHost()
})
afterEach(() => {
  resetForkPauseAllBotMailForTests()
  setStructuredAgentSessionHost(null)
  db.close()
  wakeQueuedMessages.mockReset()
  chatLine.mockReset()
  rmSync(paths.userData, { recursive: true, force: true })
})

function runtime() {
  const redrive = vi.fn()
  const service = {
    getOrchestrationDb: () => db,
    bots: { list: () => [{ id: 'bot-a', name: 'Ada' }] },
    requireStore: () => ({ getSettings: () => ({}) }),
    notifyBotGroupsChanged: () => {},
    notifyMessageArrived: () => {},
    ensureStructuredAgentSessionHost: async () => undefined,
    redriveStructuredSessionMail: redrive
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the mail owner's hold reads only these.
  return { service: service as unknown as OrcaRuntimeService, redrive }
}

function mail(subject: string) {
  return db.insertMessage({
    runId,
    from: 'dispatch:worker-1',
    to: MAILBOX,
    subject,
    type: 'status'
  })
}

function selected(service: OrcaRuntimeService): string[] {
  const owner = botMailOwner(service)
  return selectOwnedMail(
    { host: { mailHeld: owner.mailHeld }, getMessageWaiters: () => undefined },
    {
      db,
      mailboxHandle: MAILBOX,
      reservedTypes: undefined,
      sessionId: MEMBER,
      offerable: () => true
    }
  ).map((message) => message.subject)
}

describe('pause all over bot mail', () => {
  it('holds a room member chat its mail while paused and resume-all redrives it once, in order', () => {
    const { service, redrive } = runtime()
    writeForkPauseAll(true, { by: 'cli' })
    mail('first')
    mail('second')
    expect(selected(service)).toEqual([])
    expect(countForkPauseAllHeldMail(service)).toBe(2)
    expect(existsSync(join(paths.userData, PAUSE_ALL_HELD_MAIL_FILE_NAME))).toBe(true)

    writeForkPauseAll(false, { by: 'cli' })
    expect(redrive).toHaveBeenCalledTimes(1)
    expect(redrive).toHaveBeenCalledWith(MEMBER)
    expect(wakeQueuedMessages).toHaveBeenCalledWith(MEMBER)
    expect(selected(service)).toEqual(['first', 'second'])
    expect(existsSync(join(paths.userData, PAUSE_ALL_HELD_MAIL_FILE_NAME))).toBe(false)
  })

  it('holds with an unreadable switch, and passes mail when not paused', () => {
    const { service } = runtime()
    mail('only')
    expect(selected(service)).toEqual(['only'])
    writeFileSync(join(paths.userData, PAUSE_ALL_STATE_FILE_NAME), 'garbage')
    resetForkPauseAllCacheForTests()
    expect(selected(service)).toEqual([])
  })

  it('redrives at start when the switch was released while the app was down', () => {
    const before = runtime()
    writeForkPauseAll(true, { by: 'cli' })
    mail('kept')
    expect(selected(before.service)).toEqual([])

    // The app stops, the switch is released meanwhile, and a new process starts.
    rmSync(join(paths.userData, PAUSE_ALL_STATE_FILE_NAME))
    resetForkPauseAllCacheForTests()
    resetForkPauseAllBotMailForTests()
    const after = runtime()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fake runtime carries every member the mail owner reads.
    installForkPauseAllBotMail(after.service as never, true)
    expect(after.redrive).toHaveBeenCalledWith(MEMBER)
    expect(selected(after.service)).toEqual(['kept'])
    // Nothing held, nothing to redrive at the next start.
    const later = runtime()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fake runtime carries every member the mail owner reads.
    installForkPauseAllBotMail(later.service as never, true)
    expect(later.redrive).not.toHaveBeenCalled()
  })

  it('redrives through the real start, and waits for a chat host installed after it', async () => {
    writeForkPauseAll(true, { by: 'cli' })
    mail('kept')
    expect(selected(runtime().service)).toEqual([])
    rmSync(join(paths.userData, PAUSE_ALL_STATE_FILE_NAME))
    resetForkPauseAllCacheForTests()
    resetForkPauseAllBotMailForTests()

    // A start runs before the chat host is installed: nothing is redriven, and nothing is forgotten.
    setStructuredAgentSessionHost(null)
    const after = runtime()
    startBotGroupsSoon(after.service, () => true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(after.redrive).not.toHaveBeenCalled()
    expect(existsSync(join(paths.userData, PAUSE_ALL_HELD_MAIL_FILE_NAME))).toBe(true)

    installHost()
    await vi.waitFor(() => expect(after.redrive).toHaveBeenCalledWith(MEMBER))
    expect(after.redrive).toHaveBeenCalledTimes(1)
    expect(existsSync(join(paths.userData, PAUSE_ALL_HELD_MAIL_FILE_NAME))).toBe(false)
  })

  it('redrives through the real start where the chat host is there already', async () => {
    writeForkPauseAll(true, { by: 'cli' })
    mail('kept')
    expect(selected(runtime().service)).toEqual([])
    rmSync(join(paths.userData, PAUSE_ALL_STATE_FILE_NAME))
    resetForkPauseAllCacheForTests()
    resetForkPauseAllBotMailForTests()
    const after = runtime()
    startBotGroupsSoon(after.service, () => true)
    await vi.waitFor(() => expect(after.redrive).toHaveBeenCalledWith(MEMBER))
  })

  it('counts held mail in pause-status', async () => {
    const { service } = runtime()
    writeForkPauseAll(true, { by: 'cli' })
    mail('first')
    const status = FORK_PAUSE_ALL_METHODS.find((method) => method.name === 'fork.pauseAll.status')!
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the status reads only the runtime here.
    const result = await status.handler({ fleet: false } as never, { runtime: service } as never)
    expect(result).toMatchObject({ state: { engaged: true }, held: { mail: 1, handOffs: 0 } })
  })

  it("says in the chat that the owner's item comment waits, and not when running", async () => {
    const { service } = runtime()
    const owed = (id: number) =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: item mail reads only these parts of a change.
      ({
        id,
        ownerBotId: 'bot-a',
        chatId: null,
        changes: [
          {
            event: { id, kind: 'commented', actor: { kind: 'owner' }, data: {} },
            item: { uid: 'u1', number: 1 }
          }
        ]
      }) as never
    expect(await sendBotItemMail(service, owed(1))).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(chatLine).not.toHaveBeenCalled()
    writeForkPauseAll(true, { by: 'cli' })
    expect(await sendBotItemMail(service, owed(2))).toBe(true)
    await vi.waitFor(() =>
      expect(chatLine).toHaveBeenCalledWith(expect.stringContaining('once at resume-all'))
    )
  })
})
