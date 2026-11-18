import { ForkBoundaryCompactionReporter } from './boundary-compaction/ForkBoundaryCompaction'
import { ForkChatSleepReporter } from './chat-sleep/ForkChatSleep'
import { ForkDecisionInboxHost } from './decision-inbox/ForkDecisionInboxHost'
import { ForkLostWorkHost } from './lost-work/ForkLostWorkHost'
import { ForkSleepersDialogHost } from './sleepers/ForkSleepersDialog'
import { ForkUsageReportHost } from './usage-report/ForkUsageReportDialog'
import { ForkDigestHost } from './digest/ForkDigestDialog'
import { ForkWorkerCleanupReporter } from './worker-cleanup/ForkWorkerCleanup'
import { ForkWorktreeMoveDialogHost } from './worktree-move/ForkWorktreeMoveDialog'
import { ForkSnoozeCustomDialogHost } from './snooze/ForkSnoozeCustomDialog'
import { ForkSnoozeWatcher } from './snooze/ForkSnoozeWatcher'
import { ForkVisualFallbackReader } from './visual-image/ForkVisualFallbackSetting'
import { ForkPooledLimitsDialogHost } from './pooled-limits/ForkPooledLimitsDialog'
import { ForkBestOfHost } from './best-of/ForkBestOfDialog'
import { ForkChatHandoffLimitOffer } from './chat-handoff/ForkChatHandoffLimitOffer'
import { ForkLettersDialogHost } from './letters/ForkLettersDialog'

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
      <ForkDigestHost />
      <ForkLostWorkHost />
      <ForkDecisionInboxHost />
      <ForkWorktreeMoveDialogHost />
      <ForkSnoozeCustomDialogHost />
      <ForkSnoozeWatcher />
      <ForkVisualFallbackReader />
      <ForkPooledLimitsDialogHost />
      <ForkBestOfHost />
      <ForkChatHandoffLimitOffer />
      <ForkLettersDialogHost />
    </>
  )
}
