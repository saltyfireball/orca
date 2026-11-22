// Pause all (BAD-685, FORK.md "Pause all"): the persisted switch, `fork-pause-all.json` in the
// app's data folder (mode 0600, written atomically). A missing file is "not paused"; a file that
// exists but cannot be read or parsed is ENGAGED, so a damaged switch never lets work through.
// Read synchronously by every gate, cached by the file's mtime and size.
import { randomUUID } from 'node:crypto'
import { chmodSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getAppEnvironment, hasAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import {
  PAUSE_ALL_CORRUPT,
  PAUSE_ALL_OFF,
  parsePauseAll,
  pauseAllRefusal,
  serializePauseAll,
  type ForkPauseAllState
} from '../../../shared/fork/pause-all'

export const PAUSE_ALL_STATE_FILE_NAME = 'fork-pause-all.json'

export function pauseAllStatePath(): string {
  return join(getAppEnvironment().getPath('userData'), PAUSE_ALL_STATE_FILE_NAME)
}

let cache: { path: string; key: string; state: ForkPauseAllState } | null = null
const listeners = new Set<(state: ForkPauseAllState) => void>()

/** The current switch. Never throws: any failure other than "no file" reads as engaged. */
export function readForkPauseAll(): ForkPauseAllState {
  // A process that never installed its app environment has no data folder and no gated feature
  // running (unit tests, tooling); the switch cannot be engaged there.
  if (!hasAppEnvironment()) {
    return PAUSE_ALL_OFF
  }
  let path: string
  try {
    path = pauseAllStatePath()
  } catch {
    // No data folder to look in: the switch cannot be read.
    return PAUSE_ALL_CORRUPT
  }
  try {
    const stat = statSync(path)
    const key = `${stat.mtimeMs}:${stat.size}`
    if (cache && cache.path === path && cache.key === key) {
      return cache.state
    }
    const state = parsePauseAll(readFileSync(path, 'utf8'))
    cache = { path, key, state }
    return state
  } catch (error) {
    cache = null
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? PAUSE_ALL_OFF : PAUSE_ALL_CORRUPT
  }
}

export function isForkPauseAllEngaged(): boolean {
  return readForkPauseAll().engaged
}

/** The reason a gate gives when it skips work, or null when nothing is paused. */
export function forkPauseAllRefusal(): string | null {
  const state = readForkPauseAll()
  return state.engaged ? pauseAllRefusal(state) : null
}

export function onForkPauseAllChanged(listener: (state: ForkPauseAllState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Engages or releases the switch. Releasing removes the file, which also clears a corrupt one. */
export function writeForkPauseAll(
  engaged: boolean,
  options: { by: string; note?: string | null; now?: number }
): ForkPauseAllState {
  const path = pauseAllStatePath()
  let next: ForkPauseAllState = PAUSE_ALL_OFF
  if (engaged) {
    const was = readForkPauseAll()
    // Keep the first engage time and its author when the switch is already on and readable.
    next =
      was.engaged && !was.corrupt
        ? { ...was, note: options.note ?? was.note }
        : {
            engaged: true,
            since: options.now ?? Date.now(),
            by: options.by.slice(0, 40),
            note: options.note ? options.note.slice(0, 500) : null,
            corrupt: false
          }
    const temp = `${path}.${randomUUID()}.tmp`
    writeFileSync(temp, serializePauseAll(next), { mode: 0o600 })
    try {
      chmodSync(temp, 0o600)
    } catch {
      // Best effort on file systems without modes.
    }
    renameSync(temp, path)
  } else {
    rmSync(path, { force: true })
  }
  cache = null
  for (const listener of listeners) {
    try {
      listener(next)
    } catch (error) {
      console.warn('[fork-pause-all] a listener failed', error)
    }
  }
  return next
}

/** Tests. */
export function resetForkPauseAllCacheForTests(): void {
  cache = null
  listeners.clear()
}
