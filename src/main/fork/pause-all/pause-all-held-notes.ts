// The chats whose worker launch the pause-all switch holds (BAD-818): the note on disk and what it
// keeps. Upstream fails any message an earlier process left unsent, unless a person wrote it, when
// the chat is next opened: a held worker's Task text is one. So each opening of a held chat keeps
// its unsent text (pause-all-open-before-unsent.ts), and so does the one its start makes.
import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getAppEnvironment, hasAppEnvironment } from '../../../shared/app-lifecycle/app-environment'

export const PAUSE_ALL_HELD_LAUNCHES_FILE_NAME = 'fork-pause-all-held-launches.json'
const MAX_HELD = 500

function notePath(): string | null {
  return hasAppEnvironment()
    ? join(getAppEnvironment().getPath('userData'), PAUSE_ALL_HELD_LAUNCHES_FILE_NAME)
    : null
}

let cache: Set<string> | null = null
/** Launches released a moment ago (since when): their start still has to open the chat. */
const starting = new Map<string, number>()
const STARTING_MS = 5 * 60_000

export function readForkPauseAllHeldNotes(): Set<string> {
  if (cache) {
    return cache
  }
  const path = notePath()
  cache = new Set()
  if (!path) {
    return cache
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const sessions = (parsed as { sessions?: unknown })?.sessions
    if (Array.isArray(sessions)) {
      for (const id of sessions.slice(0, MAX_HELD)) {
        if (typeof id === 'string' && id.length > 0) {
          cache.add(id)
        }
      }
    }
  } catch {
    // No note, or a damaged one: nothing was held that a restart must wake.
  }
  return cache
}

export function writeForkPauseAllHeldNotes(held: Set<string>): void {
  const path = notePath()
  if (!path) {
    return
  }
  try {
    if (held.size === 0) {
      rmSync(path, { force: true })
      return
    }
    const temp = `${path}.${randomUUID()}.tmp`
    writeFileSync(temp, JSON.stringify({ version: 1, sessions: [...held] }), { mode: 0o600 })
    renameSync(temp, path)
  } catch (error) {
    console.warn('[fork-pause-all] noting a held worker launch failed', error)
  }
}

/** The queue held this chat worker's launch for the switch. */
export function noteForkPauseAllHeldLaunch(sessionId: string): void {
  const held = readForkPauseAllHeldNotes()
  if (!held.has(sessionId) && held.size < MAX_HELD) {
    held.add(sessionId)
    writeForkPauseAllHeldNotes(held)
  }
}

/** This chat's launch started, or was cancelled (its unsent text is then not kept): a restart no
 *  longer wakes it. */
export function forgetForkPauseAllHeldLaunch(sessionId: string, cancelled = false): void {
  const held = readForkPauseAllHeldNotes()
  if (held.delete(sessionId)) {
    if (!cancelled) {
      starting.set(sessionId, Date.now())
    }
    writeForkPauseAllHeldNotes(held)
  }
}

/** Hook (chat open): whether this opening keeps the chat's unsent text. */
export function forkPauseAllKeepsHeldText(sessionId: string): boolean {
  if (readForkPauseAllHeldNotes().has(sessionId)) {
    return true
  }
  const since = starting.get(sessionId)
  starting.delete(sessionId)
  return since !== undefined && Date.now() - since < STARTING_MS
}

/** Held launches not yet started, for `orca pause-status`. */
export function forkPauseAllHeldLaunchSessions(): readonly string[] {
  return [...readForkPauseAllHeldNotes()]
}

/** Tests. */
export function resetForkPauseAllHeldNotesForTests(): void {
  cache = null
  starting.clear()
}
