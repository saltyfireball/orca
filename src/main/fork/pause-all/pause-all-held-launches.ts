// Pause all over chat worker launches across a restart (BAD-818, FORK.md "Pause all"). A worker
// launch the switch holds waits as a launch queue ticket, which lives in memory; its chat keeps the
// brief queued. Each held chat is noted in `fork-pause-all-held-launches.json` (mode 0600) until its
// launch starts, so a start of the app or server wakes those chats again through the queue once the
// chat host is installed: while paused each waits again with the reason, and after a release it
// starts once with the text it kept (pause-all-held-notes.ts). A chat whose Dispatch is no longer
// active is dropped, never woken.
import {
  getStructuredAgentSessionHost,
  onStructuredAgentSessionHostChanged
} from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import type { StructuredAgentSessionAttachContext } from '../../native-chat/agent-session-wire/acquisition/structured-agent-session-attach-context'
import { startStructuredAgentSessionAgentForOperation } from '../../native-chat/agent-session-wire/startup/structured-agent-session-agent-start'
import {
  readForkPauseAllHeldNotes,
  resetForkPauseAllHeldNotesForTests,
  writeForkPauseAllHeldNotes
} from './pause-all-held-notes'
import { onForkPauseAllChanged } from './pause-all-state'

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
  const held = readForkPauseAllHeldNotes()
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
  writeForkPauseAllHeldNotes(held)
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
  if (readForkPauseAllHeldNotes().size > 0) {
    soon()
  }
}

/** Tests. */
export function resetForkPauseAllHeldLaunchesForTests(): void {
  resetForkPauseAllHeldNotesForTests()
  for (const stop of uninstalls) {
    stop()
  }
  uninstalls.clear()
}
