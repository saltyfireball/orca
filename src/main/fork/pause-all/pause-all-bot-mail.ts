// Pause all over bot mail (BAD-818, FORK.md "Pause all"). While the switch is engaged (or unreadable)
// a bot's own chats and its room member chats take no orchestration mail, as a paused bot's chats
// do: it stays unread in the orchestration database, in order, with nothing that expires it, so a
// restart keeps it. Workers running in a bot's home keep theirs. Releasing the switch redrives those
// chats once, and a start whose switch was released while the app was down does it then; delivery
// marks each mail delivered, so none is sent twice. The hold is per chat, not per sender: an owner's
// item comment or answer, which reaches the bot as item mail, waits with the rest, and its chat says so.
import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getAppEnvironment, hasAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import {
  isOrcaSessionId,
  parseOrcaSessionAddress
} from '../../../shared/agent-session/identity/orca-session-address'
import { isBotGroupMemberSession } from '../../../shared/bots/bot-group'
import { botOfHomeWorkspace } from '../../../shared/bots/bot-homes'
import type { Bot } from '../../../shared/bot-types'
import { writeInChat } from '../../bots/bot-chat-status-line'
import { heldChatSentNext, type HeldChat } from '../../bots/bot-held-chat-request'
import type { BotRequestRecord } from '../../bots/bot-request-view'
import { isBotOwnChat } from '../../bots/bot-own-chat'
import {
  getStructuredAgentSessionHost,
  onStructuredAgentSessionHostChanged
} from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { readAgentSessionRecordStore } from '../../runtime/orchestration/addressing/session-lineage/structured-session-lineage'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import {
  forkPauseAllRefusal,
  isForkPauseAllEngaged,
  onForkPauseAllChanged
} from './pause-all-state'

export const PAUSE_ALL_HELD_MAIL_FILE_NAME = 'fork-pause-all-held-mail.json'

export type PauseAllBotMailRuntime = {
  bots: { list: () => readonly Bot[] }
  getOrchestrationDb: () => OrchestrationDb
  redriveStructuredSessionMail: (sessionId: string) => void
}

function markerPath(): string | null {
  return hasAppEnvironment()
    ? join(getAppEnvironment().getPath('userData'), PAUSE_ALL_HELD_MAIL_FILE_NAME)
    : null
}

/** In memory once written: the marker says this switch held mail a restart must release. */
let marked = false

function markHeld(): void {
  const path = markerPath()
  if (marked || !path) {
    return
  }
  marked = true
  try {
    const temp = `${path}.${randomUUID()}.tmp`
    writeFileSync(temp, JSON.stringify({ version: 1, at: Date.now() }), { mode: 0o600 })
    renameSync(temp, path)
  } catch (error) {
    marked = false
    console.warn('[fork-pause-all] noting held bot mail failed', error)
  }
}

function heldMarked(): boolean {
  const path = markerPath()
  if (!path) {
    return false
  }
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}

/** The chats this switch holds mail for: a bot's own chats and its room member chats. */
function holdsMailOf(
  bots: readonly Bot[],
  db: OrchestrationDb,
  sessionId: string,
  workspaceId: string | undefined
): boolean {
  if (isBotGroupMemberSession(sessionId)) {
    return true
  }
  const store = readAgentSessionRecordStore()
  const record = store?.getRecord(sessionId)
  return Boolean(
    store &&
    record &&
    botOfHomeWorkspace(bots, workspaceId ?? record.location.workspaceId) &&
    isBotOwnChat(record, db, store)
  )
}

/** Whether `sessionId`'s mail waits for resume-all; asked by the mail owner's `mailHeld`. */
export function forkPauseAllHoldsBotMail(
  runtime: Pick<PauseAllBotMailRuntime, 'bots' | 'getOrchestrationDb'>,
  sessionId: string,
  workspaceId?: string
): boolean {
  if (!isForkPauseAllEngaged()) {
    return false
  }
  const held = holdsMailOf(
    runtime.bots.list(),
    runtime.getOrchestrationDb(),
    sessionId,
    workspaceId
  )
  if (held) {
    markHeld()
  }
  return held
}

/** A person's item comment or answer that will wait: its chat says so, with the reason. */
export function noteForkPauseAllHeldItemMail(
  runtime: Pick<PauseAllBotMailRuntime, 'bots' | 'getOrchestrationDb'>,
  sessionId: string
): void {
  const reason = forkPauseAllRefusal()
  if (reason !== null && forkPauseAllHoldsBotMail(runtime, sessionId)) {
    writeInChat(
      sessionId,
      {
        kind: 'status',
        text: `${reason} This change waits for the bot and reaches it once at resume-all.`
      },
      'pause-all'
    )
  }
}

/** The sender's receipt line for a request to a bot: while this switch holds the chat it lands in
 *  (`address`, else the chat the bot address named), that it waits for resume-all instead of saying
 *  the bot has it; otherwise upstream's line. */
export function forkPauseAllSentNext(
  runtime: Pick<PauseAllBotMailRuntime, 'bots' | 'getOrchestrationDb'>,
  address: string,
  chat: string | null,
  record: BotRequestRecord,
  held: HeldChat | null | undefined
): string {
  const sessionId = parseOrcaSessionAddress(address) ?? chat
  if (!sessionId || !forkPauseAllHoldsBotMail(runtime, sessionId)) {
    return heldChatSentNext(record, held)
  }
  const bot = record.toBotName
  const waits = `${forkPauseAllRefusal() ?? 'Paused by pause-all.'} ${bot}'s chat takes no mail until then, so this waits there unread and has not started; it reaches ${bot} once at resume-all.`
  return record.purpose === 'status'
    ? `${waits} Nothing comes back.`
    : `${waits} Its answer comes back as usual after that. Tell the asker in one line that it waits for resume-all.`
}

/** The chats whose mail this switch holds, as the agent record store lists them now. */
function heldChats(runtime: Pick<PauseAllBotMailRuntime, 'bots' | 'getOrchestrationDb'>): string[] {
  const store = readAgentSessionRecordStore()
  if (!store) {
    return []
  }
  const bots = runtime.bots.list()
  const db = runtime.getOrchestrationDb()
  return store
    .listRecords()
    .filter((record) => holdsMailOf(bots, db, record.sessionId, record.location.workspaceId))
    .map((record) => record.sessionId)
}

/** Unread mail waiting in the chats this switch holds: their own mailboxes and the Runs they
 *  coordinate. */
export function countForkPauseAllHeldMail(
  runtime: Pick<PauseAllBotMailRuntime, 'bots' | 'getOrchestrationDb'>
): number {
  const db = runtime.getOrchestrationDb()
  let count = 0
  for (const sessionId of heldChats(runtime)) {
    const handles = [
      `orca_session_id:${sessionId}`,
      ...(isOrcaSessionId(sessionId)
        ? db
            .runsBoundToCoordinator({
              orcaSessionId: sessionId,
              paneKey: null,
              terminalHandle: null
            })
            .map((run) => `run:${run.id}`)
        : [])
    ]
    for (const handle of handles) {
      count += db.getUndeliveredUnreadMessages(handle).length
    }
  }
  return count
}

/** Redrives each held chat once, as a bot's resume does; nothing while engaged, or before the
 *  chat host is installed (the marker stays, and its install releases). */
export function releaseForkPauseAllBotMail(runtime: PauseAllBotMailRuntime): number {
  if (isForkPauseAllEngaged() || !readAgentSessionRecordStore()) {
    return 0
  }
  const path = markerPath()
  marked = false
  if (path) {
    rmSync(path, { force: true })
  }
  const chats = heldChats(runtime)
  for (const sessionId of chats) {
    runtime.redriveStructuredSessionMail(sessionId)
    getStructuredAgentSessionHost()?.wakeQueuedMessages(sessionId)
  }
  return chats.length
}

const installed = new WeakSet<object>()
const started = new WeakSet<object>()
const uninstalls = new Set<() => void>()

/** Releases held mail when a switch released meanwhile (the app down, or no chat host yet) left the
 *  marker behind. */
function releaseMarked(runtime: PauseAllBotMailRuntime): void {
  if (isForkPauseAllEngaged() || !heldMarked()) {
    return
  }
  try {
    releaseForkPauseAllBotMail(runtime)
  } catch (error) {
    console.warn('[fork-pause-all] releasing held bot mail at start failed', error)
  }
}

/** Releases held mail whenever the switch is released; `atStart` also what a release while the app
 *  was down left held. A start runs before the chat host is installed, so its install does it. */
export function installForkPauseAllBotMail(runtime: PauseAllBotMailRuntime, atStart = false): void {
  if (atStart) {
    releaseMarked(runtime)
    if (!started.has(runtime)) {
      started.add(runtime)
      uninstalls.add(
        onStructuredAgentSessionHostChanged(() => {
          // After the install that told us has finished.
          setTimeout(() => releaseMarked(runtime), 0).unref?.()
        })
      )
    }
  }
  if (installed.has(runtime)) {
    return
  }
  installed.add(runtime)
  const stopSwitch = onForkPauseAllChanged((state) => {
    if (!state.engaged) {
      try {
        releaseForkPauseAllBotMail(runtime)
      } catch (error) {
        console.warn('[fork-pause-all] releasing held bot mail failed', error)
      }
    }
  })
  uninstalls.add(stopSwitch)
}

/** Tests. */
export function resetForkPauseAllBotMailForTests(): void {
  marked = false
  for (const stop of uninstalls) {
    stop()
  }
  uninstalls.clear()
}
