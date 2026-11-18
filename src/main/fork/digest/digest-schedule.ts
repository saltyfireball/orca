// Digest (SLRM-2388, FORK.md): the daily send. Once a minute while the digest is on, it checks
// the clock against the send hour and the record of the last digest (`fork-digest.json` in the
// data folder, owner-only), and sends one digest to the notify targets (SLRM-2208) when it is due.
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  forkDigestDue,
  forkDigestWindowStart,
  readForkDigestConfig,
  type ForkDigest
} from '../../../shared/fork/digest'
import { forkDigestHeadline, forkDigestPayload } from '../../../shared/fork/digest-format'
import type { ForkNotifyMessage } from '../idle-recovery/idle-recovery-notify'

const STATE_FILE = 'fork-digest.json'

export async function readForkDigestLastSentAt(userData: string): Promise<number | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(userData, STATE_FILE), 'utf8'))
    const at =
      typeof parsed === 'object' && parsed !== null && 'lastSentAt' in parsed
        ? parsed.lastSentAt
        : null
    return typeof at === 'number' && Number.isFinite(at) ? at : null
  } catch {
    // No digest sent yet.
    return null
  }
}

export async function writeForkDigestLastSentAt(userData: string, at: number): Promise<void> {
  const path = join(userData, STATE_FILE)
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify({ lastSentAt: at }), { mode: 0o600 })
  await rename(temp, path)
}

export type ForkDigestTickDeps = {
  settings: () => Parameters<typeof readForkDigestConfig>[0]
  collect: (since: number) => Promise<ForkDigest>
  send: (message: ForkNotifyMessage) => Promise<void>
}

/** One look at the clock: sends today's digest when it is due. True while the digest is on. */
export async function runForkDigestTick(
  deps: ForkDigestTickDeps,
  userData: string,
  now: number
): Promise<boolean> {
  const config = readForkDigestConfig(deps.settings())
  if (!config.enabled) {
    return false
  }
  const lastSentAt = await readForkDigestLastSentAt(userData)
  if (!forkDigestDue(now, config.hour, lastSentAt)) {
    return true
  }
  const digest = await deps.collect(forkDigestWindowStart(now, undefined, lastSentAt))
  // Recorded before the send: a target that hangs or a crash never sends one digest twice.
  await writeForkDigestLastSentAt(userData, now)
  await deps.send({
    logTag: 'fork-digest',
    desktop: config.desktop ? { title: 'Digest', body: forkDigestHeadline(digest.totals) } : null,
    webhookUrl: config.webhookUrl,
    command: config.command,
    payload: () => forkDigestPayload(digest)
  })
  return true
}
