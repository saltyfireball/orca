// SLRM-1394: startup recovery for a Claude chat whose provider an earlier app instance handed to
// its broker at quit. Instead of stopping the recovering owner (the broker), this instance claims
// it over its socket with a higher fence and asks for the output from the saved mark on. Only a
// clean claim counts: the record names this session and exactly this pid, the broker welcomes
// the fence, its provider is still running and the broker still holds every byte from the mark.
// Anything else returns false and recovery stops the owner as today. macOS only: Linux owner
// probes also read the spawn token from the process, which an adopted broker cannot match.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { StructuredAgentSessionAttachContext } from '../../native-chat/agent-session-wire/acquisition/structured-agent-session-attach-context'
import { startStructuredAgentSessionAgentForOperation } from '../../native-chat/agent-session-wire/startup/structured-agent-session-agent-start'
import { ORCA_AGENT_SESSION_ID_ENV } from '../../../shared/agent-session/lifecycle/launch/agent-session-caller-env'
import { chatSurviveBackoffPoll } from './chat-survive-backoff-poll'
import { connectChatSurviveBroker, type ChatSurviveConnection } from './chat-survive-client'
import {
  dropChatSurviveClaim,
  hasChatSurviveClaim,
  holdChatSurviveClaim,
  type ChatSurviveClaim
} from './chat-survive-claims'
import { readChatSurviveLaunchPrint } from './chat-survive-launch-hash'
import { isRecord } from './chat-survive-protocol'
import { removeChatSurviveRecord, type ChatSurviveRecord } from './chat-survive-registry'
import { chatSurviveConfig, chatSurviveRecordName } from './chat-survive-spawn'
import type { ChatSurviveStreamMark } from './chat-survive-stream-mark'
import { chatSurviveBrokerAlive } from './chat-survive-sweep'

/** How long recovery waits for a surviving broker to answer before stopping it as today. */
const CLAIM_TIMEOUT_MS = 2_000

/** How long a record waits for the owner recovery is stopping; after that the next start sweeps it. */
const FORGET_WITHIN_MS = 60_000

const forgetting = new Set<string>()

/**
 * Recovery stops an owner it does not adopt, and the app instance that would have removed the
 * broker's record at its exit has quit. So the record (it holds a token) is removed here once the
 * broker is gone, instead of at the next app start.
 */
function forgetRecordOnceGone(recordPath: string, brokerPid: number, now = Date.now): void {
  if (forgetting.has(recordPath)) {
    return
  }
  forgetting.add(recordPath)
  const deadline = now() + FORGET_WITHIN_MS
  chatSurviveBackoffPoll(
    () => {
      const gone = !chatSurviveBrokerAlive(brokerPid)
      if (gone) {
        void removeChatSurviveRecord(recordPath)
      }
      const done = gone || now() >= deadline
      if (done) {
        forgetting.delete(recordPath)
      }
      return done
    },
    100,
    2_000
  )
}

type DetachedRecord = ChatSurviveRecord & {
  sessionId: string
  detached: ChatSurviveStreamMark & { fence: number }
}

function isOffset(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function readMark(value: unknown): (ChatSurviveStreamMark & { fence: number }) | null {
  if (!isRecord(value)) {
    return null
  }
  const { out, err, seen, delivered: read, pending, fence } = value
  // A mark saved before `delivered` existed had dispatched exactly up to `seen`.
  const delivered = read === undefined ? seen : read
  if (
    !isOffset(out) ||
    !isOffset(err) ||
    !isOffset(seen) ||
    !isOffset(delivered) ||
    delivered < seen ||
    !isOffset(fence) ||
    !Array.isArray(pending) ||
    !pending.every((id) => typeof id === 'string')
  ) {
    return null
  }
  return { out, err, seen, delivered, pending, fence }
}

async function readDetachedRecord(
  path: string,
  sessionId: string,
  pid: number
): Promise<DetachedRecord | null> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
  if (!isRecord(raw)) {
    return null
  }
  const { v, sessionId: id, brokerPid, socketPath, token, launch, detached } = raw
  const mark = readMark(detached)
  // A record without its launch fingerprint, or with one in an earlier format (the single hash
  // of earlier releases), is never adopted.
  const print = readChatSurviveLaunchPrint(launch)
  if (
    v !== 1 ||
    id !== sessionId ||
    brokerPid !== pid ||
    typeof socketPath !== 'string' ||
    typeof token !== 'string' ||
    !print ||
    !mark
  ) {
    return null
  }
  return { v: 1, sessionId, brokerPid: pid, socketPath, token, launch: print, detached: mark }
}

async function claim(record: DetachedRecord): Promise<ChatSurviveConnection | null> {
  const timeout = Promise.withResolvers<null>()
  const timer = setTimeout(() => timeout.resolve(null), CLAIM_TIMEOUT_MS)
  const connecting = connectChatSurviveBroker({
    socketPath: record.socketPath,
    token: record.token,
    fence: record.detached.fence + 1,
    from: { out: record.detached.out, err: record.detached.err }
  }).catch(() => null)
  const connection = await Promise.race([connecting, timeout.promise])
  clearTimeout(timer)
  if (!connection) {
    // Too late to adopt: stop it outright, so the broker never takes this for a hand-off.
    void connecting.then((late) => late?.stop())
  }
  return connection
}

function keepsEverything(connection: ChatSurviveConnection, mark: ChatSurviveStreamMark): boolean {
  const { welcome } = connection
  return (
    welcome.exit === null &&
    // Stderr is diagnostics only: a truncated replay of it costs nothing.
    !welcome.out.truncated &&
    welcome.out.end >= mark.delivered
  )
}

/**
 * The recovery hook for a proven-alive owner on this host: true when this instance now holds the
 * owner's broker for the chat's next start, so recovery must not stop it.
 */
export async function forkChatSurviveAdopt(input: {
  sessionId: string
  ownerPid: number
  platform: NodeJS.Platform
}): Promise<boolean> {
  const config = chatSurviveConfig()
  if (!config) {
    return false
  }
  const env = { [ORCA_AGENT_SESSION_ID_ENV]: input.sessionId }
  const recordPath = join(config.recordDir, chatSurviveRecordName(env, input.ownerPid))
  const held = input.platform === 'darwin' ? await holdDetached(input, recordPath) : false
  if (!held) {
    forgetRecordOnceGone(recordPath, input.ownerPid)
  }
  return held
}

async function holdDetached(
  input: { sessionId: string; ownerPid: number },
  recordPath: string
): Promise<boolean> {
  const record = await readDetachedRecord(recordPath, input.sessionId, input.ownerPid)
  const connection = record ? await claim(record) : null
  if (!record || !connection) {
    return false
  }
  if (!keepsEverything(connection, record.detached)) {
    connection.stop()
    return false
  }
  const { detached, ...live } = record
  const held: ChatSurviveClaim = {
    connection,
    record: live,
    recordPath,
    mark: detached,
    fence: detached.fence + 1
  }
  holdChatSurviveClaim(held)
  return true
}

/**
 * After startup recovery, a start for each chat whose broker it adopted, so the provider is
 * reattached at once instead of when the chat next has work. A start that never takes the claim
 * leaves it to be stopped as today.
 */
export async function forkChatSurviveRecover(
  recovering: Promise<void>,
  ids: readonly string[],
  attachContext: () => StructuredAgentSessionAttachContext
): Promise<void> {
  await recovering
  for (const sessionId of ids) {
    if (hasChatSurviveClaim(sessionId)) {
      void startStructuredAgentSessionAgentForOperation(attachContext(), sessionId)
        .catch(() => null)
        .finally(() => dropChatSurviveClaim(sessionId))
    }
  }
}
