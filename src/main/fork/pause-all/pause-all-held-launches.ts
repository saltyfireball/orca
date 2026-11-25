// Pause all over chat worker launches across a restart (BAD-818, FORK.md "Pause all"). A worker
// launch the switch holds waits as a launch queue ticket, which lives in memory; its chat keeps the
// brief queued. Each held chat is noted in `fork-pause-all-held-launches.json` (mode 0600) until its
// launch starts, so a start of the app or server wakes those chats again through the queue once the
// chat host is installed: while paused each waits again with the reason, and after a release it
// starts once. A chat whose Dispatch is no longer active is dropped, never woken.
import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getAppEnvironment, hasAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import {
  getStructuredAgentSessionHost,
  onStructuredAgentSessionHostChanged
} from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import type { StructuredAgentSessionAttachContext } from '../../native-chat/agent-session-wire/acquisition/structured-agent-session-attach-context'
import { startStructuredAgentSessionAgentForOperation } from '../../native-chat/agent-session-wire/startup/structured-agent-session-agent-start'
import { onForkPauseAllChanged } from './pause-all-state'

export const PAUSE_ALL_HELD_LAUNCHES_FILE_NAME = 'fork-pause-all-held-launches.json'
const MAX_HELD = 500

function notePath(): string | null {
  return hasAppEnvironment()
    ? join(getAppEnvironment().getPath('userData'), PAUSE_ALL_HELD_LAUNCHES_FILE_NAME)
    : null
}

let cache: Set<string> | null = null

function readHeld(): Set<string> {
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

function writeHeld(held: Set<string>): void {
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
  const held = readHeld()
  if (!held.has(sessionId) && held.size < MAX_HELD) {
    held.add(sessionId)
    writeHeld(held)
  }
}

/** This chat's launch started (or went away): a restart no longer wakes it. */
export function forgetForkPauseAllHeldLaunch(sessionId: string): void {
  const held = readHeld()
  if (held.delete(sessionId)) {
    writeHeld(held)
  }
}

/** Held launches not yet started, for `orca pause-status`. */
export function forkPauseAllHeldLaunchSessions(): readonly string[] {
  return [...readHeld()]
}

export type ForkPauseAllHeldLaunchDeps = {
  /** Whether the chat is still a worker whose Dispatch is active; unknown keeps it for later. */
  workerState: (sessionId: string) => 'active' | 'gone' | 'unknown'
}

let startAgent: ((sessionId: string) => Promise<unknown>) | null = null

/** The chat host's own agent start (the funnel the launch queue gates), set as each host is built. */
export function forkPauseAllHeldLaunchHost(
  context: () => StructuredAgentSessionAttachContext
): void {
  startAgent = (sessionId) => startStructuredAgentSessionAgentForOperation(context(), sessionId)
}

/** Starts each held chat's agent once through the launch queue: it waits again while paused, or
 *  starts and takes the brief its chat kept. */
export function wakeForkPauseAllHeldLaunches(deps: ForkPauseAllHeldLaunchDeps): number {
  const start = startAgent
  if (!getStructuredAgentSessionHost() || !start) {
    return 0
  }
  const held = readHeld()
  let woken = 0
  for (const sessionId of held) {
    const state = deps.workerState(sessionId)
    if (state !== 'active') {
      if (state === 'gone') {
        held.delete(sessionId)
      }
      continue
    }
    woken += 1
    void start(sessionId).catch((error: unknown) =>
      console.warn('[fork-pause-all] starting a held worker launch failed', sessionId, error)
    )
  }
  writeHeld(held)
  return woken
}

const uninstalls = new Set<() => void>()

/** Wakes held launches when the chat host is (re)installed and when the switch is released. */
export function installForkPauseAllHeldLaunches(
  workerState: ForkPauseAllHeldLaunchDeps['workerState']
): void {
  const deps: ForkPauseAllHeldLaunchDeps = { workerState }
  for (const stop of uninstalls) {
    stop()
  }
  uninstalls.clear()
  // After the install that told us has finished, as the bot mail release does.
  const soon = (): void => {
    setTimeout(() => {
      try {
        wakeForkPauseAllHeldLaunches(deps)
      } catch (error) {
        console.warn('[fork-pause-all] waking held worker launches failed', error)
      }
    }, 0).unref?.()
  }
  uninstalls.add(onStructuredAgentSessionHostChanged(soon))
  uninstalls.add(
    onForkPauseAllChanged((state) => {
      if (!state.engaged) {
        soon()
      }
    })
  )
  if (readHeld().size > 0) {
    soon()
  }
}

/** Tests. */
export function resetForkPauseAllHeldLaunchesForTests(): void {
  cache = null
  for (const stop of uninstalls) {
    stop()
  }
  uninstalls.clear()
}
