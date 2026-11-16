import { ForkBoundaryCompactionReporter } from './boundary-compaction/ForkBoundaryCompaction'
import { ForkChatSleepReporter } from './chat-sleep/ForkChatSleep'
import { ForkDecisionInboxHost } from './decision-inbox/ForkDecisionInboxHost'
import { ForkLostWorkHost } from './lost-work/ForkLostWorkHost'
import { ForkSleepersDialogHost } from './sleepers/ForkSleepersDialog'
import { ForkUsageReportHost } from './usage-report/ForkUsageReportDialog'
import { ForkWorkerCleanupReporter } from './worker-cleanup/ForkWorkerCleanup'
import { ForkWorktreeMoveDialogHost } from './worktree-move/ForkWorktreeMoveDialog'

/**
 * The fork's always-mounted hosts, behind one hook in `AppRootSurfaces.tsx` so that upstream
 * file stays under its line budget. A new fork host or reporter is added here.
 */
export function ForkRootHosts(): React.JSX.Element {
  return (
    <>
      <ForkChatSleepReporter />
      <ForkBoundaryCompactionReporter />
      <ForkWorkerCleanupReporter />
      <ForkSleepersDialogHost />
      <ForkUsageReportHost />
      <ForkLostWorkHost />
      <ForkDecisionInboxHost />
      <ForkWorktreeMoveDialogHost />
    </>
  )
}
