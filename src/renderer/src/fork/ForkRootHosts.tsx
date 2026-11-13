import { ForkChatSleepReporter } from './chat-sleep/ForkChatSleep'
import { ForkSleepersDialogHost } from './sleepers/ForkSleepersDialog'
import { ForkUsageReportHost } from './usage-report/ForkUsageReportDialog'
import { ForkWorkerCleanupReporter } from './worker-cleanup/ForkWorkerCleanup'

/**
 * The fork's always-mounted hosts, behind one hook in `AppRootSurfaces.tsx` so that upstream
 * file stays under its line budget. A new fork host or reporter is added here.
 */
export function ForkRootHosts(): React.JSX.Element {
  return (
    <>
      <ForkChatSleepReporter />
      <ForkWorkerCleanupReporter />
      <ForkSleepersDialogHost />
      <ForkUsageReportHost />
    </>
  )
}
