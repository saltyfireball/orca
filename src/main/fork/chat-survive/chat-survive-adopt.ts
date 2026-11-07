// SLRM-1394: startup recovery for a Claude chat whose provider an earlier app instance handed to
// its broker at quit. Instead of stopping the recovering owner (the broker), this instance claims
// it over its socket with a higher fence and asks for the output from the saved mark on. Only a
// clean claim counts: the record names this session and exactly this pid, the broker welcomes
// the fence, its provider is still running and the broker still holds every byte from the mark.
// Anything else returns false and recovery stops the owner as today. macOS only: Linux owner
// probes also read the spawn token from the process, which an adopted broker cannot match.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StructuredAgentSessionAttachContext } from '../../native-chat/agent-session-wire/acquisition/structured-agent-session-attach-context'
import { startStructuredAgentSessionAgentForOperation } from '../../native-chat/agent-session-wire/startup/structured-agent-session-agent-start'
import { ORCA_AGENT_SESSION_ID_ENV } from '../../../shared/agent-session/lifecycle/agent-session-caller-env'
import { connectChatSurviveBroker, type ChatSurviveConnection } from './chat-survive-client'
import {
  dropChatSurviveClaim,
  hasChatSurviveClaim,
  holdChatSurviveClaim,
  type ChatSurviveClaim
} from './chat-survive-claims'
import type { ChatSurviveRecord } from './chat-survive-registry'
import { chatSurviveConfig, chatSurviveRecordName } from './chat-survive-spawn'
import type { ChatSurviveStreamMark } from './chat-survive-stream-mark'

/** How long recovery waits for a surviving broker to answer before stopping it as today. */
const CLAIM_TIMEOUT_MS = 2_000

type DetachedRecord = ChatSurviveRecord & {
  sessionId: string
  detached: ChatSurviveStreamMark & { fence: number }
}

function isOffset(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function fields(value: object, ...keys: string[]): unknown[] {
  return keys.map((key): unknown => Reflect.get(value, key))
}

function readMark(value: unknown): (ChatSurviveStreamMark & { fence: number }) | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const [out, err, seen, pending, fence] = fields(value, 'out', 'err', 'seen', 'pending', 'fence')
  if (
    !isOffset(out) ||
    !isOffset(err) ||
    !isOffset(seen) ||
    !isOffset(fence) ||
    !Array.isArray(pending) ||
    !pending.every((id) => typeof id === 'string')
  ) {
    return null
  }
  return { out, err, seen, pending, fence }
}

function readDetachedRecord(path: string, sessionId: string, pid: number): DetachedRecord | null {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const [v, id, brokerPid, socketPath, token, detached] = fields(
    raw,
    'v',
    'sessionId',
    'brokerPid',
    'socketPath',
    'token',
    'detached'
  )
  const mark = readMark(detached)
  if (
    v !== 1 ||
    id !== sessionId ||
    brokerPid !== pid ||
    typeof socketPath !== 'string' ||
    typeof token !== 'string' ||
    !mark
  ) {
    return null
  }
  return { v: 1, sessionId, brokerPid: pid, socketPath, token, detached: mark }
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
    // Too late to adopt; recovery's stop takes the broker down.
    void connecting.then((late) => late?.detach())
  }
  return connection
}

function keepsEverything(connection: ChatSurviveConnection, mark: ChatSurviveStreamMark): boolean {
  const { welcome } = connection
  return (
    welcome.exit === null &&
    !welcome.out.truncated &&
    !welcome.err.truncated &&
    welcome.out.end >= mark.seen
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
  const config = input.platform === 'darwin' ? chatSurviveConfig() : null
  if (!config) {
    return false
  }
  const env = { [ORCA_AGENT_SESSION_ID_ENV]: input.sessionId }
  const recordPath = join(config.recordDir, chatSurviveRecordName(env, input.ownerPid))
  const record = readDetachedRecord(recordPath, input.sessionId, input.ownerPid)
  const connection = record ? await claim(record) : null
  if (!record || !connection) {
    return false
  }
  if (!keepsEverything(connection, record.detached)) {
    connection.detach()
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
