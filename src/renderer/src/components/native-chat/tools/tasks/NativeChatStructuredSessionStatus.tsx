import { useState } from 'react'
import { NativeChatBackgroundTasksStatus } from './NativeChatBackgroundTasksStatus'
import type { StructuredSessionBackgroundTasksView } from '../../../../../../shared/structured-session-background-tasks-view'
import { useStructuredSessionChildRowContext } from './use-structured-session-child-row-context'
import type { StructuredSessionTaskStop } from './use-structured-session-task-stop'
import { openNativeChatSubagent } from '../../subagents/native-chat-open-subagent'
import { ForkAgentQueueBanner } from '../../../../fork/agent-queue/ForkAgentQueueBanner'

export function NativeChatStructuredSessionStatus(props: {
  sessionId: string
  /** The session's own status row, whose verdict the strip's children read; also names the pane a picked agent opens in. */
  paneKey: string
  isVisible: boolean
  /** The session's background work. */
  backgroundTasks: StructuredSessionBackgroundTasksView
  stop: StructuredSessionTaskStop
  /** The agent whose view the pane shows, marked current in the strip. */
  currentAgentId?: string | null
}): React.JSX.Element {
  const [expanded, setExpanded] = useState<{ sessionId: string; expanded: boolean } | null>(null)
  const childRowContext = useStructuredSessionChildRowContext(props.paneKey)
  const { backgroundTasks, stop } = props

  return (
    <>
      {/* Fork (SLRM-2098): queued for a free agent slot (FORK.md). */}
      <ForkAgentQueueBanner sessionId={props.sessionId} />
      {backgroundTasks.show ? (
        <NativeChatBackgroundTasksStatus
          isVisible={props.isVisible}
          tasks={backgroundTasks.tasks}
          settledTasks={backgroundTasks.settledTasks}
          {...(backgroundTasks.children
            ? { childViews: backgroundTasks.children, childRowContext }
            : {})}
          indicatorActive={backgroundTasks.isMonitoring}
          supportsTaskStop={backgroundTasks.supportsStop}
          offersStopAll={backgroundTasks.offersStopAll}
          incomplete={backgroundTasks.incomplete}
          stoppingTaskIds={stop.stoppingTaskIds}
          stoppingAll={stop.stoppingAll}
          expanded={expanded?.sessionId === props.sessionId && expanded.expanded}
          onExpandedChange={(value) => setExpanded({ sessionId: props.sessionId, expanded: value })}
          onStop={stop.onStop}
          currentAgentId={props.currentAgentId ?? null}
          onShowAgent={(providerId) => openNativeChatSubagent(props.paneKey, providerId)}
        />
      ) : null}
    </>
  )
}
