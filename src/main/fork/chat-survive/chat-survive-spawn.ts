// SLRM-1394: the spawn hook that runs a Claude provider supervisor under a chat-survive broker.
// Off unless the forkChatSurvive setting is on. Any doubt (no config, an unexpected spawn, no
// private socket folder, no broker entry on disk, a spawn that throws) spawns exactly as today,
// so there is never a second writer and never a provider without its supervisor.
import { join } from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { PipedProcessSpawner, PipedProcessSpec } from '@orca/process-host/process-spec'
import { ORCA_AGENT_SESSION_ID_ENV } from '../../../shared/agent-session/lifecycle/agent-session-caller-env'
import { chatSurviveAdoptedChild } from './chat-survive-adopted-child'
import {
  chatSurviveClaimStopping,
  hasChatSurviveClaim,
  stopChatSurviveClaim,
  takeChatSurviveClaim
} from './chat-survive-claims'
import {
  chatSurviveLaunchDiff,
  chatSurviveLaunchPrint,
  type ChatSurviveLaunchPrint
} from './chat-survive-launch-hash'
import { isProviderSupervisorSpawn, planChatSurviveBrokerSpawn } from './chat-survive-launch'
import { chatSurviveReadySocketDir } from './chat-survive-launch-ready'
import {
  dropChatSurviveBroker,
  registerChatSurviveBroker,
  removeChatSurviveRecord,
  writeChatSurviveRecord,
  type ChatSurviveEntry,
  type ChatSurviveRecord
} from './chat-survive-registry'
import { createChatSurviveStreamTracker } from './chat-survive-stream-mark'

export type ChatSurviveSpawnConfig = {
  enabled: boolean
  /** Where each broker's socket and token are kept for a later app run (phase 5). */
  recordDir: string
  /** Read only while the setting is on. */
  entryPath: string
}

let readConfig: (() => ChatSurviveSpawnConfig | null) | null = null

/** Set once by the desktop app; orcad and tests never set it, so the feature stays off there. */
export function setChatSurviveConfigReader(
  reader: (() => ChatSurviveSpawnConfig | null) | null
): void {
  readConfig = reader
}

/** True while the setting is on; a hand-off checks it again at quit, not only at spawn. */
export function chatSurviveEnabled(): boolean {
  return chatSurviveConfig() !== null
}

/** The config while the setting is on, else null. */
export function chatSurviveConfig(): ChatSurviveSpawnConfig | null {
  try {
    const config = readConfig?.() ?? null
    return config?.enabled === true ? config : null
  } catch {
    return null
  }
}

const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * The record's file name: the Orca session id (when it is a plain id) and the broker pid, so a
 * later broker for the same session never shares a file with one that is still stopping.
 */
export function chatSurviveRecordName(
  env: Record<string, string | undefined>,
  brokerPid: number
): string {
  const sessionId = env[ORCA_AGENT_SESSION_ID_ENV]
  const prefix = sessionId && SAFE_SESSION_ID.test(sessionId) ? sessionId : 'session'
  return `${prefix}.${brokerPid}.json`
}

function launchField(launch: ChatSurviveLaunchPrint | null): { launch?: ChatSurviveLaunchPrint } {
  return launch === null ? {} : { launch }
}

/** More names than any real difference has; a log line stays one line. */
const MAX_LOGGED_PARTS = 40

/**
 * Why a surviving provider is not adopted: null when this start would launch the same provider,
 * else the names of the launch parts that differ (arg flags and env keys, never their values).
 */
function launchRefusal(
  saved: ChatSurviveLaunchPrint | undefined,
  spec: PipedProcessSpec,
  env: Record<string, string | undefined>
): string | null {
  const now = chatSurviveLaunchPrint(spec, env)
  if (!saved || !now) {
    return 'no launch fingerprint to compare'
  }
  const differs = chatSurviveLaunchDiff(saved, now)
  if (differs.length === 0) {
    return null
  }
  const more = differs.length - MAX_LOGGED_PARTS
  return `launch differs in: ${differs.slice(0, MAX_LOGGED_PARTS).join(', ')}${more > 0 ? ` and ${more} more` : ''}`
}

/**
 * Saves the record off the spawn path; the broker is watched from now on either way. A record that
 * cannot be saved drops the broker from hand-off, so it stops at quit as today, and its exit
 * removes the record after any write still in flight.
 */
function saveRecord(
  child: ChildProcessWithoutNullStreams,
  path: string,
  record: ChatSurviveRecord,
  entry: ChatSurviveEntry | null,
  options: { privateDir?: boolean } = {}
): void {
  void writeChatSurviveRecord(path, record, options).catch(() => {
    // Without a record the broker cannot be adopted later; it still stops on the next app start.
    if (entry) {
      dropChatSurviveBroker(entry)
    }
  })
  child.once('exit', () => void removeChatSurviveRecord(path))
}

/**
 * The provider child for a chat whose broker startup recovery claimed (phase 5): the broker's
 * socket in place of a new spawn. Taken once; null when there is no claim for this chat. A claim
 * is taken even if the setting went off since, because its provider is running either way.
 */
function adoptedChild(
  spec: PipedProcessSpec,
  env: Record<string, string | undefined>
): ChildProcessWithoutNullStreams | null {
  const sessionId = env[ORCA_AGENT_SESSION_ID_ENV]
  if (!sessionId) {
    return null
  }
  // One writer per chat: no fresh provider, of any shape, while a surviving one may still write.
  if (chatSurviveClaimStopping(sessionId)) {
    throw new Error('the chat-survive provider for this chat is still stopping')
  }
  if (!isProviderSupervisorSpawn(spec)) {
    if (hasChatSurviveClaim(sessionId)) {
      throw new Error('the chat-survive provider for this chat is held for adoption')
    }
    return null
  }
  const claim = takeChatSurviveClaim(sessionId)
  if (!claim) {
    return null
  }
  // A provider started otherwise (model, permissions, MCP, cwd) is not the one this start expects.
  const refusal = launchRefusal(claim.record.launch, spec, env)
  if (refusal !== null) {
    // Once per refusal: the claim is gone after this, so the next start spawns as today.
    console.warn(
      `[fork-chat-survive] chat ${sessionId}: surviving provider not adopted, ${refusal}`
    )
    stopChatSurviveClaim(claim)
    throw new Error(
      'the chat-survive provider for this chat was started otherwise and is still stopping'
    )
  }
  const tracker = createChatSurviveStreamTracker(claim.mark)
  const child = chatSurviveAdoptedChild({
    connection: claim.connection,
    brokerPid: claim.record.brokerPid,
    mark: claim.mark,
    tracker
  })
  // Without its record the broker could not be adopted again; this run then owns the provider and
  // stops it at quit, as today.
  const entry = registerChatSurviveBroker({
    child,
    record: claim.record,
    recordPath: claim.recordPath,
    adopted: { tracker, fenceFloor: claim.fence }
  })
  saveRecord(child, claim.recordPath, claim.record, entry)
  return child
}

/**
 * Wraps the spawner given to the managed provider process. Spawns of anything but the POSIX
 * provider supervisor pass through untouched.
 */
export function forkChatSurviveSpawner(
  base: PipedProcessSpawner,
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  /** The private socket folder, or null when it or the broker entry is not ready. */
  readySocketDir: (entryPath: string) => string | null = chatSurviveReadySocketDir
): PipedProcessSpawner {
  return (spec) => {
    const adopted = adoptedChild(spec, env)
    if (adopted) {
      return adopted
    }
    const config = platform === 'darwin' || platform === 'linux' ? chatSurviveConfig() : null
    if (!config) {
      return base(spec)
    }
    const plan = planChatSurviveBrokerSpawn(spec, {
      entryPath: config.entryPath,
      socketDir: readySocketDir(config.entryPath)
    })
    if (!plan) {
      return base(spec)
    }
    const child = base(plan.spawn)
    const brokerPid = child.pid
    if (brokerPid === undefined) {
      return child
    }
    const sessionId = env[ORCA_AGENT_SESSION_ID_ENV] ?? null
    const record: ChatSurviveRecord = {
      v: 1,
      sessionId,
      brokerPid,
      socketPath: plan.socketPath,
      token: plan.token,
      ...launchField(chatSurviveLaunchPrint(spec, env))
    }
    const recordPath = join(config.recordDir, chatSurviveRecordName(env, brokerPid))
    // Registered now, so its output is counted from the first byte; the record follows.
    const entry =
      sessionId === null
        ? null
        : registerChatSurviveBroker({ child, record: { ...record, sessionId }, recordPath })
    saveRecord(child, recordPath, record, entry, { privateDir: true })
    return child
  }
}
