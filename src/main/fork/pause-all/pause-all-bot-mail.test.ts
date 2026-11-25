// Pause all over bot mail (BAD-818): the bot mail owner's real hold, the real orchestration database
// and mail selection, with the real switch in a temporary data folder. Mail to a room member chat
// waits unread while paused (also with an unreadable switch), is counted, and resume-all redrives the
// chat once, in order; a restart after a release while the app was down redrives it then. Faked: the
// agent-session host (its record list and queue wake) and the redrive the runtime does.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const paths = vi.hoisted(() => ({ userData: '' }))
vi.mock('../../../shared/app-lifecycle/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => paths.userData }),
  hasAppEnvironment: () => true
}))

import { botMailOwner } from '../../bots/bot-group-runtime'
import { setStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
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
  const records = [{ sessionId: MEMBER, location: { workspaceId: 'folder:room' } }]
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hold reads only the record list and the queue wake.
  setStructuredAgentSessionHost({
    deps: {
      store: {
        getConversation: (id: string) => records.find((record) => record.sessionId === id),
        listConversations: () => records,
        getVisibleSessionTabIndex: () => null
      }
    },
    wakeQueuedMessages
  } as never)
})
afterEach(() => {
  setStructuredAgentSessionHost(null)
  db.close()
  wakeQueuedMessages.mockReset()
  rmSync(paths.userData, { recursive: true, force: true })
})

function runtime() {
  const redrive = vi.fn()
  const service = {
    getOrchestrationDb: () => db,
    bots: { list: () => [] },
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
})
