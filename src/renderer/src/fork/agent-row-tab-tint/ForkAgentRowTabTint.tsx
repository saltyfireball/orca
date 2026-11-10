// SLRM-1966: the row's tab color as an overlay, so CompactAgentRow's hook is one element.
import React from 'react'
import { useAppStore } from '@/store'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import { agentRowTintStyle, resolveAgentRowTabColor } from './agent-row-tab-tint'

/**
 * Paints the tab's color dot onto its sidebar row. The parent row must be `relative`.
 * Sub-agent rows have no tab of their own (they borrow the parent's), so they stay plain.
 */
export function ForkAgentRowTabTint({
  agent
}: {
  agent: Pick<DashboardAgentRow, 'paneKey' | 'tab' | 'entry' | 'rowSource'>
}): React.JSX.Element | null {
  const isSubagent = agent.rowSource === 'subagent'
  // Select the color string only, so unrelated tab writes do not repaint every row.
  const color = useAppStore((s) =>
    isSubagent
      ? null
      : resolveAgentRowTabColor({
          worktreeId: agent.tab.worktreeId,
          tabId: agent.tab.id,
          paneKey: agent.paneKey,
          structuredHostOwned: agent.entry.structuredHostOwned === true,
          tabsByWorktree: s.tabsByWorktree,
          unifiedTabsByWorktree: s.unifiedTabsByWorktree
        })
  )
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
