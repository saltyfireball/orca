// Worker cleanup (FORK.md): Undo for one notice. A closed terminal worker resumes its conversation
// in a new terminal, the same way opening a closed worker does; a released chat is kept open so
// cleanup leaves it alone; a closed chat goes back to the renderer, which reopens its tab the way
// the closed-tab menu does.
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type {
  ForkWorkerCleanupItem,
  ForkWorkerCleanupUndoResult
} from '../../../shared/fork/worker-cleanup'
import { openClosedWorkerTerminal } from '../../runtime/rpc/methods/orchestration/worker/closed-worker-terminal'
import type { WorkerTerminalReleaseRuntime } from '../../runtime/orchestration/terminal-authority/release/worker-terminal-release-runtime'
import { takeNotice } from './worker-cleanup-notices'
import { forkWorkerCleanupRuntime } from './worker-cleanup-service'

export type WorkerCleanupUndoDeps = {
  reopenTerminal: (handle: string) => Promise<boolean>
  keepOpen: (paneKey: string) => void
}

export async function undoWorkerCleanupItems(
  items: ForkWorkerCleanupItem[],
  deps: WorkerCleanupUndoDeps
): Promise<ForkWorkerCleanupUndoResult> {
  const reopenChats: ForkWorkerCleanupItem[] = []
  for (const item of items) {
    try {
      if (item.kind === 'chat-closed') {
        reopenChats.push(item)
      } else if (item.kind === 'chat-released') {
        deps.keepOpen(item.paneKey)
      } else {
        await deps.reopenTerminal(item.handle)
      }
    } catch (error) {
      console.warn('[fork worker cleanup] undo step failed', error)
    }
  }
  return { reopenChats }
}

// The installed runtime is the app's OrcaRuntimeService; the binding hook only sees its base class.
function canReopen(runtime: WorkerTerminalReleaseRuntime): runtime is OrcaRuntimeService {
  return 'getLiveTerminalPaneKey' in runtime && typeof runtime.getLiveTerminalPaneKey === 'function'
}

export function undoForkWorkerCleanup(noticeId: string): Promise<ForkWorkerCleanupUndoResult> {
  const items = takeNotice(noticeId)
  const runtime = forkWorkerCleanupRuntime()
  return undoWorkerCleanupItems(items, {
    reopenTerminal: async (handle) => {
      if (!runtime || !canReopen(runtime)) {
        return false
      }
      return (
        (await openClosedWorkerTerminal(runtime, runtime.getOrchestrationDb(), handle)) !== null
      )
    },
    keepOpen: (paneKey) => {
      runtime?.getOrchestrationDb().keepWorkerTerminalOpen(paneKey)
    }
  })
}
