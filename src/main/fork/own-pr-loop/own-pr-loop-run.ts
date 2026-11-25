// Own pull request loop limit (BAD-819, FORK.md "Own pull request loop limit"): the run hook
// connector-cloud-install.ts calls for each trigger delivery, bound to this host's runtime and store.
import type { AutomationRunEvent } from '../../../shared/automation-event-triggers'
import type { AutomationRun } from '../../../shared/automations/history/automation-run'
import type { ConnectorDelivery } from '../../../shared/connectors/connector-cloud-contract'
import { splitWorktreeId } from '../../../shared/worktree/id'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { notifyForkInboxSourceChanged } from '../idle-recovery/idle-recovery-sources'
import { runOwnPrLoopGuarded, type OwnPrLoopDeps } from './own-pr-loop-guard'
import type { OwnPrLoopInboxStore } from './own-pr-loop-inbox'

type TriggerDelivery = Extract<ConnectorDelivery, { kind: 'trigger' }>
// A run's newest workers; the one that opened the pull request is among them.
const RUN_WORKERS_READ = 20

export type OwnPrLoopHost = {
  runtime: Pick<OrcaRuntimeService, 'runAutomationForEvent' | 'getOrchestrationDb'> & {
    showManagedTerminalWorkspace(worktreeSelector: string): Promise<{ branch?: string | null }>
  }
  store: OwnPrLoopInboxStore & OwnPrLoopDeps['store']
  userDataPath: string
}

/** The worktrees on this host a run's work is in: its own workspace when that is a worktree, and
 *  those of the workers its chat started. `unknown` when a worker is on a paired server, whose
 *  worktree id names that server's worktree, not one here. */
export function runWorktrees(
  db: OrchestrationDb,
  run: Pick<AutomationRun, 'workspaceId' | 'chatSessionId'>
): { worktrees: Set<string>; unknown: boolean } {
  const worktrees = new Set<string>()
  let unknown = false
  if (run.workspaceId && splitWorktreeId(run.workspaceId)) {
    worktrees.add(run.workspaceId)
  }
  if (run.chatSessionId) {
    const ids = db.listDispatchIdsCreatedBySession(run.chatSessionId, RUN_WORKERS_READ)
    for (const row of ids.length > 0 ? db.listWorkerTerminalResources({ dispatchIds: ids }) : []) {
      if (db.getFederatedDispatch(row.dispatchId)) {
        unknown = true
      } else if (row.worktreeId) {
        worktrees.add(row.worktreeId)
      }
    }
  }
  return { worktrees, unknown }
}

function hostDeps(host: OwnPrLoopHost): OwnPrLoopDeps {
  const { runtime, store } = host
  return {
    store,
    runBranches: async (run) => {
      const { worktrees, unknown } = runWorktrees(runtime.getOrchestrationDb(), run)
      let unread = unknown
      const branches: string[] = []
      for (const worktreeId of worktrees) {
        const workspace = await runtime
          .showManagedTerminalWorkspace(`id:${worktreeId}`)
          .catch(() => null)
        if (workspace?.branch) {
          branches.push(workspace.branch)
        } else if (!workspace) {
          unread = true
        }
      }
      // Cannot tell which run opened it: only the window cap holds.
      return branches.length === 0 && unread ? null : branches
    },
    runForEvent: (id, event, gate) => runtime.runAutomationForEvent(id, event, gate),
    stopped: notifyForkInboxSourceChanged
  }
}

/** The run a trigger delivery's event starts, through the own pull request loop limit. */
export function forkOwnPrLoopRun(
  host: OwnPrLoopHost,
  delivery: TriggerDelivery
): (automationId: string, event: AutomationRunEvent) => Promise<AutomationRun | null> {
  const deps = hostDeps(host)
  return (automationId, event) => runOwnPrLoopGuarded(deps, automationId, event, delivery)
}
