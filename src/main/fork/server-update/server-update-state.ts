// Server updates (FORK.md, SLRM-2310): the record that carries an update across its own restart.
// The server writes it just before the restart; the next server to start reads it, says whether it
// is the version that was asked for, and writes the ready mark the watchdog waits on.
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ForkServerUpdateJob } from '../../../shared/fork/server-update-wire'

export const FORK_SERVER_UPDATE_STATE_FILE = 'fork-server-update.json'
export const FORK_SERVER_UPDATE_READY_FILE = 'fork-server-update.ready'

export function forkServerUpdateStatePath(userDataPath: string): string {
  return join(userDataPath, FORK_SERVER_UPDATE_STATE_FILE)
}

export function forkServerUpdateReadyPath(userDataPath: string): string {
  return join(userDataPath, FORK_SERVER_UPDATE_READY_FILE)
}

const PHASES: readonly ForkServerUpdateJob['phase'][] = [
  'restarting',
  'done',
  'failed',
  'rolled-back'
]

/** The saved record when it has every field a job needs; anything else reads as none. */
export function parseForkServerUpdateState(value: unknown): ForkServerUpdateJob | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const record: Record<string, unknown> = { ...value }
  const { id, kind, phase, fromVersion, targetVersion, startedAt, updatedAt, message } = record
  const settledPhase = PHASES.find((entry) => entry === phase)
  if (
    typeof id !== 'string' ||
    (kind !== 'update' && kind !== 'rollback') ||
    !settledPhase ||
    typeof fromVersion !== 'string' ||
    typeof targetVersion !== 'string' ||
    typeof startedAt !== 'number' ||
    typeof updatedAt !== 'number'
  ) {
    return null
  }
  return {
    id,
    kind,
    phase: settledPhase,
    fromVersion,
    targetVersion,
    startedAt,
    updatedAt,
    ...(typeof message === 'string' ? { message } : {})
  }
}

export async function readForkServerUpdateState(
  userDataPath: string
): Promise<ForkServerUpdateJob | null> {
  try {
    return parseForkServerUpdateState(
      JSON.parse(await readFile(forkServerUpdateStatePath(userDataPath), 'utf8'))
    )
  } catch {
    return null
  }
}

export async function writeForkServerUpdateState(
  userDataPath: string,
  job: ForkServerUpdateJob
): Promise<void> {
  const path = forkServerUpdateStatePath(userDataPath)
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(job), { mode: 0o600 })
  await rename(temporary, path)
}

/**
 * At start-up: settles an update this server's restart finished. The version that was asked for
 * means done (and the ready mark); the old version means the watchdog put it back. Returns the
 * settled job, or null when there was nothing to settle.
 */
export async function settleForkServerUpdateAtStart(
  userDataPath: string,
  runningVersion: string,
  now: number
): Promise<ForkServerUpdateJob | null> {
  const job = await readForkServerUpdateState(userDataPath)
  if (!job || job.phase !== 'restarting') {
    return null
  }
  let settled: ForkServerUpdateJob
  if (runningVersion === job.targetVersion) {
    settled = { ...job, phase: 'done', updatedAt: now, message: `running ${runningVersion}` }
  } else if (runningVersion === job.fromVersion) {
    settled = {
      ...job,
      phase: 'rolled-back',
      updatedAt: now,
      message: `${job.targetVersion} did not come up in time; ${runningVersion} was put back`
    }
  } else {
    settled = {
      ...job,
      phase: 'failed',
      updatedAt: now,
      message: `came back on ${runningVersion}, not ${job.targetVersion}`
    }
  }
  await writeForkServerUpdateState(userDataPath, settled)
  if (settled.phase === 'done') {
    // The watchdog compares the mark with the job id, so a stale mark never passes.
    await writeFile(forkServerUpdateReadyPath(userDataPath), job.id, { mode: 0o600 })
  }
  return settled
}

export async function clearForkServerUpdateReady(userDataPath: string): Promise<void> {
  await rm(forkServerUpdateReadyPath(userDataPath), { force: true })
}
