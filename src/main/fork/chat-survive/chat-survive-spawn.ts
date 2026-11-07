// SLRM-1394: the spawn hook that runs a Claude provider supervisor under a chat-survive broker.
// Off unless the forkChatSurvive setting is on. Any doubt (no config, an unexpected spawn, no
// private socket folder, no broker entry on disk, a spawn that throws) spawns exactly as today,
// so there is never a second writer and never a provider without its supervisor.
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type {
  PipedChildProcess,
  PipedProcessSpawner,
  PipedProcessSpec
} from '@orca/process-host/process-spec'
import { ORCA_AGENT_SESSION_ID_ENV } from '../../../shared/agent-session/lifecycle/agent-session-caller-env'
import { chatSurviveAdoptedChild } from './chat-survive-adopted-child'
import { chatSurviveClaimStopping, takeChatSurviveClaim } from './chat-survive-claims'
import {
  chatSurviveSocketDir,
  isProviderSupervisorSpawn,
  planChatSurviveBrokerSpawn
} from './chat-survive-launch'
import {
  registerChatSurviveBroker,
  writeChatSurviveRecord,
  type ChatSurviveRecord
} from './chat-survive-registry'
import { createChatSurviveStreamTracker } from './chat-survive-stream-mark'

export type ChatSurviveSpawnConfig = {
  enabled: boolean
  /** Where each broker's socket and token are kept for a later app run (phase 5). */
  recordDir: string
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

function writeRecord(dir: string, name: string, record: ChatSurviveRecord): string | null {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const path = join(dir, name)
    writeChatSurviveRecord(path, record)
    return path
  } catch {
    // Without a record the broker cannot be adopted later; it still stops on the next app start.
    return null
  }
}

/**
 * The provider child for a chat whose broker startup recovery claimed (phase 5): the broker's
 * socket in place of a new spawn. Taken once; null when there is no claim for this chat. A claim
 * is taken even if the setting went off since, because its provider is running either way.
 */
function adoptedChild(
  spec: PipedProcessSpec,
  env: Record<string, string | undefined>
): PipedChildProcess | null {
  const sessionId = env[ORCA_AGENT_SESSION_ID_ENV]
  if (!sessionId || !isProviderSupervisorSpawn(spec)) {
    return null
  }
  if (chatSurviveClaimStopping(sessionId)) {
    // One writer per chat: a fresh provider waits until the dropped one has stopped.
    throw new Error('the chat-survive provider for this chat is still stopping')
  }
  const claim = takeChatSurviveClaim(sessionId)
  if (!claim) {
    return null
  }
  const tracker = createChatSurviveStreamTracker(claim.mark)
  const child = chatSurviveAdoptedChild({
    connection: claim.connection,
    brokerPid: claim.record.brokerPid,
    mark: claim.mark,
    tracker
  })
  // Without its record the broker could not be adopted again; it still stops as today then.
  try {
    writeChatSurviveRecord(claim.recordPath, claim.record)
    child.once('exit', () => rmSync(claim.recordPath, { force: true }))
    registerChatSurviveBroker({
      child,
      record: claim.record,
      recordPath: claim.recordPath,
      adopted: { tracker, fenceFloor: claim.fence }
    })
  } catch {
    // The record is gone or unwritable: this run owns the provider and stops it at quit.
  }
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
  socketDir: () => string | null = chatSurviveSocketDir
): PipedProcessSpawner {
  return (spec) => {
    const adopted = adoptedChild(spec, env)
    if (adopted) {
      return adopted
    }
    const config = platform === 'darwin' || platform === 'linux' ? chatSurviveConfig() : null
    if (!config || !existsSync(config.entryPath)) {
      return base(spec)
    }
    const plan = planChatSurviveBrokerSpawn(spec, {
      entryPath: config.entryPath,
      socketDir: socketDir()
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
      token: plan.token
    }
    const recordPath = writeRecord(config.recordDir, chatSurviveRecordName(env, brokerPid), record)
    if (recordPath) {
      child.once('exit', () => rmSync(recordPath, { force: true }))
      if (sessionId !== null) {
        registerChatSurviveBroker({ child, record: { ...record, sessionId }, recordPath })
      }
    }
    return child
  }
}
