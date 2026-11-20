// Worker cleanup (FORK.md): closing finished workers through the stock release path, shared by the
// cleanup sweep and the worker archive's terminal stop.
import type { ForkWorkerCleanupItem } from '../../../shared/fork/worker-cleanup'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { WorkerTerminalReleaseRuntime } from '../../runtime/orchestration/terminal-authority/release/worker-terminal-release-runtime'
import { reconcileRequestedWorkerTerminalReleases } from '../../runtime/orchestration/terminal-authority/release/worker-terminal-release-reconciliation'
import {
  requireRunningStructuredWorker,
  resolveStructuredWorkerIdentity
} from '../../runtime/orchestration/terminal-authority/structured-sessions/structured-worker-authority'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { claimWorkerCleanupRelease } from './worker-cleanup-query'
import type { WorkerCleanupCandidate } from './worker-cleanup-query'

export function chatSessionOf(handle: string, db: OrchestrationDb): string | null {
  const identity = resolveStructuredWorkerIdentity(handle, db)
  if (!identity) {
    return null
  }
  try {
    return requireRunningStructuredWorker(identity).sessionId
  } catch {
    return identity.sessionId
  }
}

export async function closeThroughStockRelease(
  runtime: WorkerTerminalReleaseRuntime,
  db: OrchestrationDb,
  candidates: WorkerCleanupCandidate[]
): Promise<ForkWorkerCleanupItem[]> {
  const now = Date.now()
  const claimed = candidates.flatMap((candidate) => {
    // Read the chat before release: a closed session no longer resolves its successor.
    const sessionId = chatSessionOf(candidate.terminalHandle, db)
    return claimWorkerCleanupRelease(db, candidate.resourceId, now)
      ? [{ candidate, sessionId }]
      : []
  })
  if (claimed.length === 0) {
    return []
  }
  await reconcileRequestedWorkerTerminalReleases(runtime)
  const host = getStructuredAgentSessionHost()
  return claimed.flatMap(({ candidate, sessionId }): ForkWorkerCleanupItem[] => {
    const row = db.getWorkerTerminalResource(candidate.resourceId)
    if (!row || row.release_state !== 'released' || !candidate.worktreeId) {
      return []
    }
    if (sessionId) {
      const agent = host?.sessionAgent(sessionId) ?? null
      return agent
        ? [
            {
              kind: 'chat-closed',
              worktreeId: candidate.worktreeId,
              sessionId,
              agent
            }
          ]
        : []
    }
    return [
      {
        kind: 'terminal-closed',
        worktreeId: candidate.worktreeId,
        handle: row.terminal_handle
      }
    ]
  })
}
