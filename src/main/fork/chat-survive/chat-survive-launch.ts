// SLRM-1394: the app side of starting a provider under a chat-survive broker. It turns the spawn
// of a provider supervisor into the spawn of a broker that runs that same supervisor, and makes
// the broker's private socket and token.
import { randomBytes } from 'node:crypto'
import { lstat, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PipedProcessSpec } from '@orca/process-host/process-spec'
import { POSIX_PROVIDER_SUPERVISOR_SCRIPT } from '../../provider-process/provider-process-supervisor'
import {
  CHAT_SURVIVE_SPEC_ENV,
  encodeChatSurviveBrokerSpec,
  type ChatSurviveBrokerSpec
} from './chat-survive-broker-spec'

/** Built beside the main bundle (config/build-plugins/main-build-entry-points.ts). */
export const CHAT_SURVIVE_BROKER_ENTRY_FILE = 'chat-survive-broker-entry.js'

/** How long a provider may run with no app attached before its broker stops it. */
export const CHAT_SURVIVE_DEFAULT_ORPHAN_TIMEOUT_MS = 60 * 60 * 1000

/** macOS caps a Unix socket path at 104 bytes including the terminator. */
const MAX_SOCKET_PATH_BYTES = 103

/** The spawn of upstream's POSIX provider supervisor, which is the only thing a broker may run. */
export function isProviderSupervisorSpawn(spec: Pick<PipedProcessSpec, 'args'>): boolean {
  const [flag, script, separator] = spec.args ?? []
  return flag === '-e' && script === POSIX_PROVIDER_SUPERVISOR_SCRIPT && separator === '--'
}

/** Makes the broker socket folder and checks it is private: a folder, ours, no group or other bits. */
export async function prepareChatSurviveSocketDir(dir: string): Promise<boolean> {
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const stat = await lstat(dir)
    const uid = process.getuid?.()
    return (
      stat.isDirectory() && (uid === undefined || stat.uid === uid) && (stat.mode & 0o077) === 0
    )
  } catch {
    return false
  }
}

/**
 * A private folder for broker sockets under the per-user temp folder, or null when it cannot be
 * made private (someone else's folder, a symlink, loose mode). Callers then spawn as today.
 */
export async function chatSurviveSocketDir(base: string = tmpdir()): Promise<string | null> {
  const dir = join(base, 'orca-chat-survive')
  return (await prepareChatSurviveSocketDir(dir)) ? dir : null
}

export type ChatSurviveBrokerPlan = {
  spawn: PipedProcessSpec
  socketPath: string
  token: string
}

/**
 * The broker spawn for one supervised provider spawn, or null when it cannot be planned safely
 * (not a supervisor spawn, no private socket folder, a path too long to bind).
 */
export function planChatSurviveBrokerSpawn(
  supervisor: PipedProcessSpec,
  input: {
    entryPath: string
    socketDir: string | null
    ownerPid?: number
    execPath?: string
    orphanTimeoutMs?: number
  }
): ChatSurviveBrokerPlan | null {
  if (!isProviderSupervisorSpawn(supervisor) || !input.socketDir) {
    return null
  }
  const socketPath = join(input.socketDir, `${randomBytes(9).toString('hex')}.sock`)
  if (Buffer.byteLength(socketPath) > MAX_SOCKET_PATH_BYTES) {
    return null
  }
  const token = randomBytes(32).toString('hex')
  const spec: ChatSurviveBrokerSpec = {
    v: 1,
    socketPath,
    token,
    ownerPid: input.ownerPid ?? process.pid,
    orphanTimeoutMs: input.orphanTimeoutMs ?? CHAT_SURVIVE_DEFAULT_ORPHAN_TIMEOUT_MS
  }
  const execPath = input.execPath ?? process.execPath
  return {
    socketPath,
    token,
    spawn: {
      ...supervisor,
      program: execPath,
      // The supervisor command runs unchanged after the separator.
      args: [input.entryPath, '--', supervisor.program, ...(supervisor.args ?? [])],
      env: {
        ...supervisor.env,
        ELECTRON_RUN_AS_NODE: '1',
        [CHAT_SURVIVE_SPEC_ENV]: encodeChatSurviveBrokerSpec(spec)
      }
    }
  }
}
