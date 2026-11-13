import { useState } from 'react'
import { NativeChatBackgroundTasksStatus } from './NativeChatBackgroundTasksStatus'
import type { StructuredSessionBackgroundTasksView } from '../../../../../../shared/agent-session/view/structured-session-background-tasks-view'
import { useStructuredSessionChildRowContext } from './use-structured-session-child-row-context'
import type { StructuredSessionTaskStop } from './use-structured-session-task-stop'
import { openNativeChatSubagent } from '../../subagents/native-chat-open-subagent'
import { ForkAgentQueueBanner } from '../../../../fork/agent-queue/ForkAgentQueueBanner'
import { ForkMcpProfileStrip } from '../../../../fork/mcp-profiles/ForkMcpProfileStrip'

export function NativeChatStructuredSessionStatus(props: {
  sessionId: string
  /** Fork: the pane's agent, for the MCP profile strip before the chat has a record. */
  agent?: string
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
  const childRowContext = useStructuredSessionChildRowContext(
    props.paneKey,
    props.isVisible && props.backgroundTasks.show && Boolean(props.backgroundTasks.children?.length)
  )
  const { backgroundTasks, stop } = props

  return (
    <>
      {/* Fork (SLRM-2098): queued for a free agent slot (FORK.md). */}
      <ForkAgentQueueBanner sessionId={props.sessionId} />
      {/* Fork: the chat's MCP profile (FORK.md "MCP profiles"). */}
      <ForkMcpProfileStrip sessionId={props.sessionId} agent={props.agent} />
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
