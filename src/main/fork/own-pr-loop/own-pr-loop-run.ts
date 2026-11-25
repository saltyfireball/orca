// Own pull request loop limit (BAD-819, FORK.md "Own pull request loop limit"): the run hook
// connector-cloud-install.ts calls for each trigger delivery, bound to this host's runtime and store.
import type { AutomationRunEvent } from '../../../shared/automation-event-triggers'
import type { AutomationRun } from '../../../shared/automations/history/automation-run'
import type { ConnectorDelivery } from '../../../shared/connectors/connector-cloud-contract'
import { splitWorktreeId } from '../../../shared/worktree/id'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { notifyForkInboxSourceChanged } from '../idle-recovery/idle-recovery-sources'
import { runOwnPrLoopGuarded, type OwnPrLoopDeps } from './own-pr-loop-guard'
import { installOwnPrLoopInbox, type OwnPrLoopInboxStore } from './own-pr-loop-inbox'

type TriggerDelivery = Extract<ConnectorDelivery, { kind: 'trigger' }>
// A run's newest workers; the one that opened the pull request is among them.
const RUN_WORKERS_READ = 20

export type OwnPrLoopHost = {
  runtime: Pick<OrcaRuntimeService, 'runAutomationForEvent'> & {
    getOrchestrationDb(): {
      listDispatchIdsCreatedBySession(orcaSessionId: string, limit: number): string[]
      listWorkerTerminalResources(params: {
        dispatchIds: string[]
      }): readonly { worktreeId: string | null }[]
    }
    showManagedTerminalWorkspace(worktreeSelector: string): Promise<{ branch?: string | null }>
  }
  store: OwnPrLoopInboxStore & OwnPrLoopDeps['store']
  userDataPath: string
}

/** The worktrees a run's work is in: its own workspace when that is a worktree, and those of the
 *  workers its chat started. */
function runWorktrees(runtime: OwnPrLoopHost['runtime'], run: AutomationRun): Set<string> {
  const worktrees = new Set<string>()
  if (run.workspaceId && splitWorktreeId(run.workspaceId)) {
    worktrees.add(run.workspaceId)
  }
  if (run.chatSessionId) {
    const db = runtime.getOrchestrationDb()
    const ids = db.listDispatchIdsCreatedBySession(run.chatSessionId, RUN_WORKERS_READ)
    for (const row of ids.length > 0 ? db.listWorkerTerminalResources({ dispatchIds: ids }) : []) {
      if (row.worktreeId) {
        worktrees.add(row.worktreeId)
      }
    }
  }
  return worktrees
}

function hostDeps(host: OwnPrLoopHost): OwnPrLoopDeps {
  const { runtime, store } = host
  return {
    store,
    runBranches: async (run) => {
      const branches: string[] = []
      for (const worktreeId of runWorktrees(runtime, run)) {
        const workspace = await runtime
          .showManagedTerminalWorkspace(`id:${worktreeId}`)
          .catch(() => null)
        if (workspace?.branch) {
          branches.push(workspace.branch)
        }
      }
      return branches
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
  installOwnPrLoopInbox(host.store, host.userDataPath)
  const deps = hostDeps(host)
  return (automationId, event) => runOwnPrLoopGuarded(deps, automationId, event, delivery)
}
