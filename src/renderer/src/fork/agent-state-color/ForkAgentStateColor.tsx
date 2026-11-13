// Agent state colors (FORK.md) on a tab and its sidebar agent row. Every input is a state the
// surface already shows (its state glyph, the unread mark, the fork's stalled, queued and
// asleep marks), so the color can never disagree with the icon next to it. The icons and labels
// stay as they are; the color only adds to them. Renders nothing while the setting is off, and
// subscribes to the stall and queue feeds only while it is on.
import React from 'react'
import { useAppStore } from '@/store'
import {
  forkAgentColorState,
  forkAgentStateColorStyle,
  forkAgentStateColorsShowOn,
  forkAgentStateColorsStrength,
  resolveForkAgentColor,
  type ForkAgentColorState
} from '../../../../shared/fork/agent-state-color'
import { useForkChatStallEntry } from '../chat-stall/chat-stall-store'
import { chatSessionIdForPaneKey } from '../chat-stall/chat-stall-view'
import { useForkQueuedLaunch } from '../agent-queue/use-fork-agent-queue'
import { useSleepingChatRow, useSleepingChatTab } from '../chat-sleep/ForkChatSleep'
import {
  terminalTabActivityToAgentDotState,
  type TerminalTabActivityStatus
} from '@/components/tab-bar/terminal-tab-activity-status'

/** The overlay for a resolved state; the parent must be `relative`. */
function StateColorOverlay({
  state,
  manualColor,
  className
}: {
  state: ForkAgentColorState | null
  manualColor: string | null | undefined
  className: string
}): React.JSX.Element | null {
  // Primitive selections, so unrelated settings writes do not repaint every tab and row.
  const color = useAppStore((s) => {
    const resolved = resolveForkAgentColor({ manualColor, state, settings: s.settings })
    // The manual color is painted by the tab's own dot and SLRM-1966's row tint, not here.
    return resolved.source === 'state' ? resolved.color : null
  })
  const strength = useAppStore((s) => forkAgentStateColorsStrength(s.settings))
  if (!color || !state) {
    return null
  }
  return (
    <span
      aria-hidden
      data-fork-agent-state-color={state}
      className={className}
      style={forkAgentStateColorStyle(color, strength)}
    />
  )
}

type TabProps = {
  worktreeId: string
  manualColor: string | null | undefined
  /** The tab's activity, as its state glyph shows it. */
  activityStatus: TerminalTabActivityStatus
  unread: boolean
  /** A native chat's session id; terminal tabs have none. */
  sessionId: string | undefined
}

function TabStateColor({
  worktreeId,
  manualColor,
  activityStatus,
  unread,
  sessionId
}: TabProps): React.JSX.Element | null {
  const dotState = terminalTabActivityToAgentDotState(activityStatus)
  const stalled = useForkChatStallEntry(sessionId) !== null
  const queued = useForkQueuedLaunch(sessionId) !== null
  const asleep = useSleepingChatTab(worktreeId, sessionId)
  const state = forkAgentColorState({ dotState, unread, stalled, queued, asleep })
  return (
    <StateColorOverlay
      state={state}
      manualColor={manualColor}
      className="pointer-events-none absolute inset-0"
    />
  )
}

/** A tab strip tab's state color. SortableTab's root is `relative`. */
export function ForkTabStateColor(props: TabProps): React.JSX.Element | null {
  const show = useAppStore((s) => forkAgentStateColorsShowOn(s.settings, 'tab'))
  return show && !props.manualColor ? <TabStateColor {...props} /> : null
}

type RowSubject = { paneKey: string; tab: { worktreeId: string }; rowSource?: string }

type RowProps = {
  agent: RowSubject
  manualColor: string | null
  dotState: string | null
  unread: boolean
}

function RowStateColor({ agent, manualColor, dotState, unread }: RowProps): React.JSX.Element {
  const sessionId = useAppStore(
    (s) => chatSessionIdForPaneKey(s.unifiedTabsByWorktree[agent.tab.worktreeId], agent.paneKey) ?? undefined
  )
  const stalled = useForkChatStallEntry(sessionId) !== null
  const queued = useForkQueuedLaunch(sessionId) !== null
  const asleep = useSleepingChatRow(agent)
  const state = forkAgentColorState({ dotState, unread, stalled, queued, asleep })
  return (
    <StateColorOverlay
      state={state}
      manualColor={manualColor}
      className="pointer-events-none absolute inset-0 rounded-[inherit]"
    />
  )
}

/**
 * A sidebar agent row's state color. Sub-agent rows stay plain, as they do for the manual tint,
 * and so does a row whose tab has a manual color (SLRM-1966 paints that one).
 */
export function ForkRowStateColor(props: RowProps): React.JSX.Element | null {
  const show = useAppStore((s) => forkAgentStateColorsShowOn(s.settings, 'row'))
  if (!show || props.manualColor || props.agent.rowSource === 'subagent') {
    return null
  }
  return <RowStateColor {...props} />
}
