// Server memory protection (SLRM-2384, FORK.md): the terminal daemon's one hook. Under a unit that
// `orca serve service protect` lowered the OOM score of, the daemon (started by the server) would
// inherit that low score and hand it to every agent. Instead it raises its own score to the
// drop-in's child value at start, so the kernel kills agents before the server. Raising a score
// needs no privilege; a value at or below the current one is left alone. Linux only, never throws.
import { readFile, writeFile } from 'node:fs/promises'
import { serveProtectChildOomFromEnv } from '../../../shared/fork/serve-protect'

const OOM_SCORE_FILE = '/proc/self/oom_score_adj'

export type DaemonOomScoreIo = {
  read: (path: string) => Promise<string>
  write: (path: string, value: string) => Promise<void>
}

const realIo: DaemonOomScoreIo = {
  read: (path) => readFile(path, 'utf8'),
  write: (path, value) => writeFile(path, value)
}

/** Returns the score it set, or null when it set none. */
export async function forkRaiseDaemonOomScore(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  io: DaemonOomScoreIo = realIo
): Promise<number | null> {
  if (platform !== 'linux') {
    return null
  }
  const target = serveProtectChildOomFromEnv(env)
  if (target === null) {
    return null
  }
  try {
    const current = Number((await io.read(OOM_SCORE_FILE)).trim())
    if (!Number.isInteger(current) || target <= current) {
      return null
    }
    await io.write(OOM_SCORE_FILE, String(target))
    return target
  } catch {
    return null
  }
}
