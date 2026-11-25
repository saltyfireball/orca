// Pause all over the terminal-worker restart resume (BAD-799, FORK.md "Pause all"). While the switch
// is engaged (or unreadable) a restart offers its terminal workers instead of sending them a continue
// prompt, and notes which ones it held in `fork-pause-all-restart-holds.json` (mode 0600). Releasing
// the switch resumes exactly those, once, but never before this start's restored terminals are placed:
// the note is cleared before the resume starts, and the Dispatch's own offered-to-resumed claim
// refuses a second one. A resume that fails leaves the worker offered to a person, and a damaged
// note releases nothing, so those workers stay ordinary offers.
import { randomUUID } from 'node:crypto'
import { chmod, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { getAppEnvironment, hasAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import { PAUSE_ALL_REASON_PREFIX } from '../../../shared/fork/pause-all'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import {
  isWorkerRestartOffered,
  isWorkerRestartResumeOpen,
  WORKER_RESTART_OFFERED_STAGE,
  WORKER_RESTART_RESUMED_STAGE
} from '../../runtime/orchestration/db/worker-dispatch/worker-restart-resume'
import { isForkPauseAllEngaged, onForkPauseAllChanged } from './pause-all-state'

export const PAUSE_ALL_RESTART_HOLDS_FILE_NAME = 'fork-pause-all-restart-holds.json'
/** What the offer row says about a worker this switch held. */
export const PAUSE_ALL_RESTART_HELD_REASON = `${PAUSE_ALL_REASON_PREFIX} at restart: \`orca resume-all\` resumes it.`
const MAX_HELD = 500
const HeldFile = z.object({ version: z.literal(1), held: z.array(z.string()).max(MAX_HELD) })

export type PauseAllRestartHoldsDeps = {
  getDb: () => OrchestrationDb | null
  /** The Resume work on restart setting. */
  resumeWorkOnRestart: () => boolean
  /** A person's Resume of one offered worker, at most once; `fail` runs when it does not come back. */
  resumeOffered: (dispatchId: string, fail: () => void) => Promise<boolean>
  offersChanged: () => void
}

function holdsPath(): string | null {
  return hasAppEnvironment()
    ? join(getAppEnvironment().getPath('userData'), PAUSE_ALL_RESTART_HOLDS_FILE_NAME)
    : null
}

async function readHeld(path: string): Promise<string[]> {
  try {
    const parsed = HeldFile.safeParse(JSON.parse(await readFile(path, 'utf8')))
    return parsed.success ? parsed.data.held : []
  } catch {
    return []
  }
}

async function writeHeld(path: string, held: readonly string[]): Promise<void> {
  if (held.length === 0) {
    await rm(path, { force: true })
    return
  }
  const temp = `${path}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify({ version: 1, held: held.slice(-MAX_HELD) }), {
    mode: 0o600
  })
  // Best effort on file systems without modes.
  await chmod(temp, 0o600).catch(() => undefined)
  await rename(temp, path)
}

/** A released worker whose resume failed goes back to waiting on a person; false when it is settled. */
export function reofferReleasedWorker(db: OrchestrationDb, dispatchId: string): boolean {
  if (!isWorkerRestartResumeOpen(db, dispatchId)) {
    return false
  }
  const changed = db.db
    .prepare(
      `UPDATE worker_dispatches SET stage = ?, updated_at = datetime('now')
        WHERE dispatch_id = ? AND state = 'ready' AND stage = ?`
    )
    .run(WORKER_RESTART_OFFERED_STAGE, dispatchId, WORKER_RESTART_RESUMED_STAGE)
  return Number(changed.changes) > 0
}

export class ForkPauseAllRestartHolds {
  private readonly held = new Set<string>()
  private readonly path = holdsPath()
  /** The note as the last start left it, merged under what this start holds meanwhile. */
  private readonly loaded: Promise<void>
  private saving: Promise<void> = Promise.resolve()
  private releasing: Promise<string[]> | null = null
  /** Restored terminals are placed: before then a resume could open a worker its own pane restores. */
  private settled = false

  constructor(private readonly deps: PauseAllRestartHoldsDeps) {
    this.loaded = this.path
      ? readHeld(this.path).then((ids) => ids.forEach((id) => this.held.add(id)))
      : Promise.resolve()
    onForkPauseAllChanged((state) => {
      if (!state.engaged && this.settled) {
        void this.release()
      }
    })
  }

  /** Stands in for the setting for one lost worker: false while paused, noting the worker held. */
  resumes(dispatchId: string): boolean {
    if (!this.deps.resumeWorkOnRestart()) {
      return false
    }
    if (!isForkPauseAllEngaged()) {
      return true
    }
    if (!this.held.has(dispatchId) && !this.isOffered(dispatchId)) {
      this.held.add(dispatchId)
      void this.loaded.then(() => this.save())
      console.info('[fork-pause-all] a terminal worker restart resume is offered, not sent', {
        dispatchId
      })
    }
    return false
  }

  /** This start's restored terminals are placed: a switch released meanwhile, or while the app was
   *  down, resumes the held workers now. */
  startupSettled(): void {
    this.settled = true
    void this.release()
  }

  /** The held workers and why, for their offer rows. */
  heldReasons(): ReadonlyMap<string, string> {
    return new Map([...this.held].map((id) => [id, PAUSE_ALL_RESTART_HELD_REASON]))
  }

  /** Resumes the workers this switch held, once; the ones it resumed. */
  release(): Promise<string[]> {
    this.releasing ??= this.releaseNow().finally(() => (this.releasing = null))
    return this.releasing
  }

  private isOffered(dispatchId: string): boolean {
    const db = this.deps.getDb()
    return db !== null && isWorkerRestartOffered(db, dispatchId)
  }

  private save(): Promise<void> {
    const path = this.path
    if (!path) {
      return Promise.resolve()
    }
    const snapshot = [...this.held]
    this.saving = this.saving
      .then(() => writeHeld(path, snapshot))
      .catch((error: unknown) => {
        console.warn('[fork-pause-all] saving the held terminal workers failed', error)
      })
    return this.saving
  }

  private async releaseNow(): Promise<string[]> {
    await this.loaded
    if (!this.settled || isForkPauseAllEngaged() || this.held.size === 0) {
      return []
    }
    const held = [...this.held]
    this.held.clear()
    // Cleared first, so a crash mid-resume never resumes a worker a second time.
    await this.save()
    this.deps.offersChanged()
    // Turned off meanwhile: the setting leaves them to a person.
    if (!this.deps.resumeWorkOnRestart()) {
      return []
    }
    const outcomes = await Promise.all(
      held.map((dispatchId) =>
        this.deps.resumeOffered(dispatchId, () => this.reoffer(dispatchId)).catch(() => false)
      )
    )
    const resumed = held.filter((_, index) => outcomes[index])
    console.info('[fork-pause-all] resumed terminal workers held at restart', {
      held: held.length,
      resumed: resumed.length
    })
    this.deps.offersChanged()
    return resumed
  }

  /** Not a person's Resume: a failed one leaves the worker offered, where a person can try again. */
  private reoffer(dispatchId: string): void {
    const db = this.deps.getDb()
    try {
      if (db && reofferReleasedWorker(db, dispatchId)) {
        this.deps.offersChanged()
      }
    } catch (error) {
      console.warn('[fork-pause-all] offering a held terminal worker again failed', error)
    }
  }
}
