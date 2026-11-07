// SLRM-1394: the spawn hook that runs a Claude provider supervisor under a chat-survive broker.
// Off unless the forkChatSurvive setting is on. Any doubt (no config, an unexpected spawn, no
// private socket folder, no broker entry on disk, a spawn that throws) spawns exactly as today,
// so there is never a second writer and never a provider without its supervisor.
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { PipedProcessSpawner } from '@orca/process-host/process-spec'
import { ORCA_AGENT_SESSION_ID_ENV } from '../../../shared/agent-session/lifecycle/agent-session-caller-env'
import { chatSurviveSocketDir, planChatSurviveBrokerSpawn } from './chat-survive-launch'
import {
  registerChatSurviveBroker,
  writeChatSurviveRecord,
  type ChatSurviveRecord
} from './chat-survive-registry'

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
  return currentConfig() !== null
}

function currentConfig(): ChatSurviveSpawnConfig | null {
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
    const config = platform === 'darwin' || platform === 'linux' ? currentConfig() : null
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
