// SLRM-1966: the row's tab color as an overlay, so CompactAgentRow's hook is one element.
import React from 'react'
import { useAppStore } from '@/store'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import { agentRowTintStyle, resolveAgentRowTabColor } from './agent-row-tab-tint'

export type AgentRowTabColorSubject = Pick<DashboardAgentRow, 'paneKey' | 'tab' | 'rowSource'>

/**
 * The color dot of the row's tab, or null. Sub-agent rows have no tab of their own (they borrow
 * the parent's), so they get none. Shared by the row tint and the collapsed strip's icon ring.
 */
export function useAgentRowTabColor(agent: AgentRowTabColorSubject): string | null {
  const isSubagent = agent.rowSource === 'subagent'
  // Select the color string only, so unrelated tab writes do not repaint every row.
  return useAppStore((s) =>
    isSubagent
      ? null
      : resolveAgentRowTabColor({
          worktreeId: agent.tab.worktreeId,
          tabId: agent.tab.id,
          paneKey: agent.paneKey,
          tabsByWorktree: s.tabsByWorktree,
          unifiedTabsByWorktree: s.unifiedTabsByWorktree
        })
  )
}

/** Paints the tab's color dot onto its sidebar row. The parent row must be `relative`. */
export function ForkAgentRowTabTint({
  agent
}: {
  agent: AgentRowTabColorSubject
}): React.JSX.Element | null {
  const color = useAgentRowTabColor(agent)
  const style = agentRowTintStyle(color)
  if (!style) {
    return null
  }
  return (
    <span
      aria-hidden
      data-fork-row-tab-color={color ?? undefined}
      className="pointer-events-none absolute inset-0 rounded-[inherit]"
      style={style}
    />
  )
}
