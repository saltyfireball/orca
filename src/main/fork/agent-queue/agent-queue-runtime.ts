// SLRM-2098, BAD-818 (FORK.md "Agent launch queue", "Pause all"): what the launch queue reads of the
// runtime, for the desktop and for orcad alike. A chat worker is known by its recorded worker row as
// well as by its start, so a start a restart replays still waits as a worker while paused.
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { resolveStructuredWorkerIdentityForSession } from '../../runtime/orchestration/terminal-authority/structured-sessions/structured-worker-authority'
import type { PtyLike } from './live-agents'

/**
 * The terminal side of the runtime, given at install so this module (which runtime and chat code
 * import) never reaches Electron.
 */
export type ForkAgentQueueTerminals = {
  ptys: () => ReadonlyMap<string, PtyLike> | undefined
  /** The pty an orchestration terminal handle runs in, if it is live. */
  ptyIdOfHandle: (handle: string) => string | undefined
  /** BAD-818: a chat's Dispatch when it is a recorded worker, for a start no worker-start noted here (a restart's). */
  recordedWorker?: (sessionId: string) => { dispatchId: string } | undefined
}

export function forkAgentQueueRuntimeTerminals(
  runtime: () => OrcaRuntimeService | null | undefined
): ForkAgentQueueTerminals {
  return {
    // Protected on the runtime; bracket access keeps them type-checked against upstream renames.
    ptys: () => runtime()?.['ptysById'],
    ptyIdOfHandle: (handle) => runtime()?.['getLivePtyForHandle'](handle)?.pty.ptyId,
    // Throws while the runtime or its database is not there yet: the caller cannot tell then.
    recordedWorker: (sessionId) => {
      const current = runtime()
      if (!current) {
        throw new Error('The runtime is not ready.')
      }
      // A profile without the database has no workers.
      const db = current.getExistingOrchestrationDb()
      const worker = db ? resolveStructuredWorkerIdentityForSession(sessionId, db) : null
      if (!db || !worker) {
        return undefined
      }
      const dispatch = db.getActiveDispatchForTerminal(worker.handle, worker.paneKey)
      return dispatch ? { dispatchId: dispatch.id } : undefined
    }
  }
}

export function recordedWorkerOf(
  terminals: ForkAgentQueueTerminals,
  sessionId: string
): { dispatchId: string; parentKey?: string } | undefined {
  try {
    return terminals.recordedWorker?.(sessionId)
  } catch (error) {
    console.warn('[fork-agent-queue] could not read whether a chat is a worker', error)
    return undefined
  }
}

/** Whether the chat is a worker with an active Dispatch; unknown while that cannot be read yet. */
export function recordedWorkerState(
  terminals: ForkAgentQueueTerminals,
  sessionId: string
): 'active' | 'gone' | 'unknown' {
  if (!terminals.recordedWorker) {
    return 'unknown'
  }
  try {
    return terminals.recordedWorker(sessionId) ? 'active' : 'gone'
  } catch {
    return 'unknown'
  }
}
