// SLRM-1966: in a workspace card's collapsed agent strip, each icon whose tab has a color dot
// gets a thin ring in that color, so the strip still says which icon is which tab.
import React from 'react'
import { useAppStore } from '@/store'
import { agentIconRingStyle, resolveAgentIconTabColor } from './agent-row-tab-tint'

/** A ring over the strip icon's own border. The parent icon must be `relative`. */
export function ForkAgentIconTabRing({
  agent
}: {
  agent: { paneKey: string }
}): React.JSX.Element | null {
  // Select the color string only, so unrelated tab writes do not repaint every icon.
  const color = useAppStore((s) =>
    resolveAgentIconTabColor({
      paneKey: agent.paneKey,
      tabsByWorktree: s.tabsByWorktree,
      unifiedTabsByWorktree: s.unifiedTabsByWorktree
    })
  )
  const style = agentIconRingStyle(color)
  if (!style) {
    return null
  }
  return (
    <span
      aria-hidden
      data-fork-icon-tab-color={color ?? undefined}
      className="pointer-events-none absolute -inset-px rounded-full"
      style={style}
    />
  )
}
